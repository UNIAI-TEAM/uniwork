/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import type { LibraryBridge } from "../library/model";
import { createDesktopTextSurface } from "./text-surface";
import type { DesktopSurfaceSettings } from "./surface";

const utf8 = (value: string) => new TextEncoder().encode(value);
const bridge = { call: vi.fn() } as unknown as LibraryBridge;

function settings(bytes: Uint8Array, over: Partial<DesktopSurfaceSettings> = {}): DesktopSurfaceSettings {
  return { documentId: "doc-1", readBytes: async () => bytes.slice(), generation: 0, readOnly: false, bridge, sessionGeneration: "s", ...over };
}

type TextFacets = { source: { getText(): string; setText(text: string): void; subscribe(listener: (text: string) => void): () => void }; getText(): string; setText(text: string): void };
async function opened(format: "md" | "html", bytes: Uint8Array, over: Partial<DesktopSurfaceSettings> = {}) {
  const surface = createDesktopTextSurface(format, settings(bytes, over));
  await surface.open();
  return surface as typeof surface & TextFacets;
}

it("round-trips BOM, CRLF and Vietnamese text byte for byte without an edit", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("# Xin chào\r\nTiếng Việt có dấu: đ ệ ơ\r\n")]);
  const surface = await opened("md", bytes);
  expect(surface.getText()).toBe("# Xin chào\r\nTiếng Việt có dấu: đ ệ ơ\r\n");
  const snapshot = await surface.captureSnapshot();
  expect(Array.from(snapshot.value)).toEqual(Array.from(bytes));
  expect(snapshot.sizeBytes).toBe(bytes.length);
  expect(snapshot.checksumSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(snapshot.generation).toBe(0);
  expect(surface.openOutcome!()).toEqual({ outcome: "opened", document_id: "doc-1", document_model_ref: "desktop-text:doc-1", warnings: [] });
});

it("keeps a BOM-less file BOM-less and encodes an edit as UTF-8", async () => {
  const surface = await opened("html", utf8("<p>a</p>"));
  surface.setText("<p>đổi</p>");
  const snapshot = await surface.captureSnapshot();
  expect(new TextDecoder().decode(snapshot.value)).toBe("<p>đổi</p>");
  expect(snapshot.value[0]).toBe(0x3c);
  expect(snapshot.generation).toBe(1);
});

it("bumps the dirty generation (offset by the session's) and notifies dirty and source listeners", async () => {
  const surface = await opened("md", utf8("a"), { generation: 5 });
  expect(surface.getDirtyGeneration()).toBe(5);
  const dirty = vi.fn();
  const text = vi.fn();
  surface.subscribeDirty!(dirty);
  surface.source.subscribe(text);
  surface.setText("ab");
  surface.setText("ab");
  expect(dirty).toHaveBeenCalledTimes(1);
  expect(dirty).toHaveBeenCalledWith(6);
  expect(text).toHaveBeenCalledWith("ab");
  surface.undo!();
  expect(surface.getText()).toBe("a");
  expect(dirty).toHaveBeenLastCalledWith(7);
  surface.redo!();
  expect(surface.getText()).toBe("ab");
  expect(surface.getDirtyGeneration()).toBe(8);
  surface.undo!(); surface.undo!();
  expect(surface.getText()).toBe("a");
});

it("serialises the snapshot it captured, not the live text typed afterwards", async () => {
  const surface = await opened("md", utf8("one"));
  surface.setText("two");
  const snapshot = await surface.captureSnapshot();
  surface.setText("three");
  expect(new TextDecoder().decode(snapshot.value)).toBe("two");
  expect(surface.getText()).toBe("three");
  snapshot.value[0] = 0;
  expect(new TextDecoder().decode((await surface.captureSnapshot()).value)).toBe("three");
});

it("bounds undo history to 100 entries", async () => {
  const surface = await opened("md", utf8("0"));
  for (let index = 1; index <= 150; index++) surface.setText(String(index));
  for (let index = 0; index < 200; index++) surface.undo!();
  expect(surface.getText()).toBe("50");
  surface.undo!();
  expect(surface.getText()).toBe("50");
});

it("fails the open on invalid UTF-8 with a typed corrupted outcome, never U+FFFD", async () => {
  const surface = createDesktopTextSurface("md", settings(new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x41])));
  await expect(surface.open()).rejects.toMatchObject({ failureClass: "corrupted" });
  expect(surface.openOutcome!()).toMatchObject({ outcome: "failed", document_id: "doc-1", format: "md", failure_class: "corrupted" });
});

it("ignores edits on a read-only open", async () => {
  const surface = await opened("html", utf8("<p>x</p>"), { readOnly: true });
  const dirty = vi.fn();
  surface.subscribeDirty!(dirty);
  surface.setText("<p>y</p>");
  surface.source.setText("<p>z</p>");
  expect(surface.getText()).toBe("<p>x</p>");
  expect(dirty).not.toHaveBeenCalled();
  expect(surface.getDirtyGeneration()).toBe(0);
});

it("refuses to capture after dispose and drops its listeners", async () => {
  const surface = await opened("md", utf8("x"));
  const listener = vi.fn();
  surface.subscribeDirty!(listener);
  await surface.dispose();
  await expect(surface.captureSnapshot()).rejects.toThrow("text_editor_disposed");
  surface.setText("y");
  expect(listener).not.toHaveBeenCalled();
});
