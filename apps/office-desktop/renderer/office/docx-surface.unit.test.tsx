/** @vitest-environment jsdom */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { parseDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDesktopDocxSurface } from "./docx-surface";

Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => ({ length: 0, item: () => null }) });
Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
const source = Uint8Array.from(readFileSync(resolve("../../docs/office/g0/fixtures/files/docs/docx-simple.docx")));

it("renders the shared surface and serializes a real edit with its actual byte checksum", async () => {
  const editor = createDesktopDocxSurface({ documentId: "doc", readBytes: async () => source, generation: 4 });
  const dirty = vi.fn();
  const unsubscribe = editor.subscribeDirty!(dirty);
  try {
    await editor.open();
    render(<>{editor.renderSurface?.()}</>);
    expect(screen.getByTestId("docx-document-surface")).toBeInTheDocument();
    expect(editor.openOutcome()?.outcome).toBe("opened");
    act(() => editor.commands?.setHeading(2));
    expect(dirty).toHaveBeenLastCalledWith(5);
    const snapshot = await editor.captureSnapshot();
    expect(snapshot.generation).toBe(5);
    expect(snapshot.checksumSha256).toBe(`sha256:${createHash("sha256").update(snapshot.value).digest("hex")}`);
    expect((await parseDocx(snapshot.value)).blocks[0]).toMatchObject({ type: "heading", level: 2 });
    const repeat = await editor.captureSnapshot();
    expect(repeat.fingerprint).toBe(snapshot.fingerprint);
    expect(repeat.value).toEqual(snapshot.value);
    snapshot.value.fill(0);
    expect((await editor.captureSnapshot()).value).toEqual(repeat.value);
  } finally { unsubscribe(); await editor.dispose(); }
});

it("captures N while the next edit remains N+1 with live undo/redo", async () => {
  const editor = createDesktopDocxSurface({ documentId: "doc", readBytes: async () => source });
  try {
    await editor.open();
    editor.commands?.setHeading(2);
    const pending = editor.captureSnapshot();
    editor.commands?.setHeading(3);
    const snapshot = await pending;
    expect(snapshot.generation).toBe(1);
    expect(editor.getDirtyGeneration()).toBe(2);
    expect((await parseDocx(snapshot.value)).blocks[0]).toMatchObject({ type: "heading", level: 2 });
    editor.undo?.();
    // Adjacent toolbar transactions share the normal TipTap undo group.
    expect(editor.commands?.getState().headingLevel).toBe(1);
    editor.redo?.();
    expect(editor.commands?.getState().headingLevel).toBe(3);
  } finally { await editor.dispose(); }
});

it("refuses snapshots after disposal and rejects corrupt input instead of making a blank document", async () => {
  const invalid = createDesktopDocxSurface({ documentId: "bad", readBytes: async () => new Uint8Array([1, 2, 3]) });
  await expect(invalid.open()).rejects.toThrow();
  expect(invalid.renderSurface?.()).toBeNull();
  await invalid.dispose();
  await expect(invalid.captureSnapshot()).rejects.toThrow("docx_editor_disposed");
});

it("refuses a snapshot when disposal happens during asynchronous capture", async () => {
  const editor = createDesktopDocxSurface({ documentId: "doc", readBytes: async () => source });
  await editor.open();
  const pending = editor.captureSnapshot();
  const assertion = expect(pending).rejects.toThrow("docx_editor_disposed");
  await editor.dispose();
  await assertion;
});

it("does not refuse a document above the 64 MiB server input bound", async () => {
  // Zeros are not a package, so a host that got past the size gate reports a
  // corrupt/not-office file; the server bound would report too_large.
  const editor = createDesktopDocxSurface({ documentId: "doc", readBytes: async () => new Uint8Array(65 * 1024 * 1024) });
  try {
    const outcome = await editor.open().then(() => "opened", (error: unknown) => error);
    expect(JSON.stringify(outcome, Object.getOwnPropertyNames(outcome as object))).not.toContain("too_large");
    expect(outcome).not.toBe("opened");
  } finally { await editor.dispose(); }
});
