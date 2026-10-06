// @vitest-environment jsdom
/**
 * HtmlEditor with the visual editor: the whole chain from the injected host to
 * a document change, against the real html engine (fixture parse map).
 *
 *   flag ON  + host -> the preview is mounted in visual-edit mode with the
 *                      sid-stamped copy; a selection raises the float toolbar;
 *                      an action is an op in the engine's source, the draft is
 *                      marked dirty and checkpointed, Save still goes through
 *                      the coordinator.
 *   flag OFF        -> no inspector request, no stamped copy, no toolbar.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlEditor } from "./editor";
import { openFixture, type OpenFixture } from "./visual/ops/test-fixture";
import { elementByPath } from "./visual/ops";
import type { HtmlEditorHandle, HtmlOpenOutcome } from "./types";
import type { IsolatedPreviewPort, PreviewMountOptions } from "../source-editor-types";

const flagMock = vi.hoisted(() => ({ value: true }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_edit" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = true;
  await setLocale("en");
});

const SOURCE = `<main><p>One</p><p>Two</p></main>`;
const P1 = "main:nth-of-type(1) > p:nth-of-type(1)";

function makeCoordinator() {
  const state = { state: "dirty" as const, dirtyGeneration: 1, lastSavedGeneration: 0, identity: { deploymentId: "dep", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v", baseRevision: "1" }, activeIntentId: null, error: null };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    markDirty: vi.fn(),
    checkpoint: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };
}

function previewPort() {
  const sends: Array<(event: { type: string }) => void> = [];
  const mount = vi.fn(async (options: PreviewMountOptions) => {
    if (options.onEvent) sends.push(options.onEvent);
    return { dispose: vi.fn(), update: vi.fn(), inspector: { command: vi.fn(() => true), close: vi.fn() } };
  });
  return { port: { mount } as IsolatedPreviewPort, mount, emit: (event: Record<string, unknown>) => sends.forEach((send) => send(event as { type: string })) };
}

async function renderEditor(f: OpenFixture, withHost = true) {
  const preview = previewPort();
  const coordinator = makeCoordinator();
  const editor: HtmlEditorHandle = {
    format: "html",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { source: "" } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    source: { getText: () => f.engine.snapshot(f.ref).text, setText: vi.fn() },
    getAssetManifest: () => ({ entries: [] }),
  };
  const outcome: HtmlOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "model", warnings: [] };
  render(
    <HtmlEditor
      documentKey="doc"
      editor={editor}
      open={{ open: vi.fn(async () => outcome) }}
      coordinator={coordinator}
      capability={{ format: "html", operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available", fidelityWarnings: [] }}
      preview={preview.port}
      visualEdit={withHost ? {
        parseMap: () => f.engine.parseMap(f.ref),
        revision: () => f.engine.snapshot(f.ref).revision,
        applyPatchSet: (set) => void f.engine.applyPatchSet(f.ref, set),
      } : undefined}
    />,
  );
  await waitFor(() => expect(preview.mount).toHaveBeenCalled());
  return { preview, coordinator, editor };
}

function select(emit: (event: Record<string, unknown>) => void, sid: number) {
  act(() => {
    emit({ type: "select", sid });
    emit({ type: "rect", sid, rect: { x: 10, y: 10, width: 120, height: 24 } });
  });
}

describe("HtmlEditor visual edit", () => {
  it("flag ON + host: visual-edit mount with the stamped copy, and a toolbar action edits the engine source", async () => {
    const f = await openFixture(SOURCE);
    const { preview, coordinator } = await renderEditor(f);
    const options = preview.mount.mock.calls[0]![0] as PreviewMountOptions & { visualEdit?: { nonce: string } };
    expect(options.visualEdit?.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(options.text).toMatch(/<p data-sid="\d+">One<\/p>/);

    select(preview.emit, elementByPath(f.map, P1)!.sid);
    const duplicate = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-float-action="duplicate"]');
      if (!found) throw new Error("no float toolbar yet");
      return found;
    });
    fireEvent.click(duplicate);

    expect(f.engine.snapshot(f.ref).text).toBe(`<main><p>One</p><p>One</p><p>Two</p></main>`);
    expect(coordinator.markDirty).toHaveBeenCalled();
    expect(coordinator.checkpoint).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId("html-editor"), { key: "s", ctrlKey: true });
    expect(coordinator.save).toHaveBeenCalledWith("shortcut");
  });

  it("flag OFF: no inspector request, no stamped copy, no toolbar", async () => {
    flagMock.value = false;
    const f = await openFixture(SOURCE);
    const { preview } = await renderEditor(f);
    const options = preview.mount.mock.calls[0]![0] as PreviewMountOptions & { visualEdit?: unknown };
    expect(options).not.toHaveProperty("visualEdit");
    expect(options.text).toBe(SOURCE);
    select(preview.emit, elementByPath(f.map, P1)!.sid);
    expect(document.querySelector('[data-testid="html-float-toolbar"]')).toBeNull();
    expect(document.querySelector('[data-testid="html-style-panel"]')).toBeNull();
  });

  it("flag ON without a host (desktop today): the same plain surface", async () => {
    const f = await openFixture(SOURCE);
    const { preview } = await renderEditor(f, false);
    const options = preview.mount.mock.calls[0]![0] as PreviewMountOptions & { visualEdit?: unknown };
    expect(options).not.toHaveProperty("visualEdit");
    expect(options.text).toBe(SOURCE);
  });
});
