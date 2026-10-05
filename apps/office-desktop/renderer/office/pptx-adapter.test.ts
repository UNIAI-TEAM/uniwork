/** @vitest-environment node */
// UNI-927 W7: the desktop editor handle forwards the runtime's minted ids and
// layout catalog, and a released session reads empty instead of a freed ref.
import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import { pptxSessionDivergedError, type PptxEdit } from "@uniwork/office-engine/pptx";
import { createDesktopPptxAdapter } from "./pptx-adapter";
import type { PptxSessionRuntime } from "./pptx-runtime";

const identity = { deploymentId: "lane", accountId: "a", organizationId: "o", workspaceId: "w", documentId: "doc", generation: 1 } as OfficeIdentity;
const capability = { format: "pptx", operation: "edit", host: "desktop", engineBuild: "t", contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [] } as never;
const layouts = [{ name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" }];

function runtime(): PptxSessionRuntime {
  return {
    open: vi.fn(async ({ documentId }) => ({ outcome: "opened" as const, document_id: documentId, document_model_ref: "m1", snapshot: { revision: 0, edits: [] }, warnings: [] })),
    edit: vi.fn(async (_ref, edits) => (edits[0]?.op === "add_element" ? { revision: 1, createdIds: ["new_1"] } : { revision: 1 })),
    snapshot: vi.fn(() => ({ revision: 0, edits: [] })),
    undo: vi.fn(async () => true),
    redo: vi.fn(async () => true),
    serialize: vi.fn(async () => ({ bytes: new Uint8Array([1]), checksum: "c" })),
    setBaseRevision: vi.fn(async () => undefined),
    deck: vi.fn(),
    slides: vi.fn(() => []),
    slideLayouts: vi.fn(() => layouts),
    release: vi.fn(async () => undefined),
  } as unknown as PptxSessionRuntime;
}

describe("desktop PPTX adapter handle", () => {
  it("forwards the Save intent to serialize and the commit to the runtime rebase (W14), never after dispose", async () => {
    const backing = runtime();
    const adapter = createDesktopPptxAdapter({ identity, runtime: backing, readBytes: async () => new Uint8Array([80, 75, 3, 4]), capability });
    await adapter.open();
    const snapshot = { generation: 1, fingerprint: "fp", value: { revision: 0, edits: [] } };
    await adapter.editor.serialize(snapshot, "intent-1");
    expect(backing.serialize).toHaveBeenCalledWith("m1", { snapshot, intentId: "intent-1" });
    await adapter.editor.setBaseRevision("7", "intent-1");
    expect(backing.setBaseRevision).toHaveBeenCalledExactlyOnceWith("m1", "7", "intent-1");
    await adapter.editor.dispose();
    await adapter.editor.setBaseRevision("8", "intent-2");
    expect(backing.setBaseRevision).toHaveBeenCalledTimes(1);
  });

  it("hands back the minted ids, the layout catalog, and reads empty once disposed", async () => {
    const adapter = createDesktopPptxAdapter({ identity, runtime: runtime(), readBytes: async () => new Uint8Array([80, 75, 3, 4]), capability });
    expect(adapter.editor.slideLayouts()).toEqual([]);
    await adapter.open();
    expect(adapter.editor.slideLayouts()).toEqual(layouts);
    const insert: PptxEdit = { op: "add_element", slideIndex: 0, kind: "rect", xPx: 1, yPx: 1, wPx: 10, hPx: 10 };
    expect(await adapter.editor.edit([insert])).toEqual({ revision: 1, createdIds: ["new_1"] });
    expect(await adapter.editor.edit([{ op: "delete_slide", slideIndex: 0 }])).toEqual({ revision: 1 });
    await adapter.editor.dispose();
    expect(adapter.editor.slideLayouts()).toEqual([]);
  });

  // UNI-927 W12b: a diverged session must not look like a no-op undo/redo.
  it("marks the deck dirty on a diverged undo/redo and swallows a plain refusal", async () => {
    const engine = runtime();
    const onDirty = vi.fn();
    const adapter = createDesktopPptxAdapter({ identity, runtime: engine, readBytes: async () => new Uint8Array([80, 75, 3, 4]), capability, onDirty });
    await adapter.open();
    const viewBefore = adapter.editor.revision();

    // A refusal that left the model untouched stays a silent no-op.
    vi.mocked(engine.undo).mockRejectedValueOnce(new Error("pptx_undo_replay_failed"));
    adapter.editor.undo();
    await vi.waitFor(() => expect(engine.undo).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(adapter.editor.getDirtyGeneration()).toBe(0);
    expect(onDirty).not.toHaveBeenCalled();

    // The diverged refusal marks the deck dirty so the save runs and fails loudly.
    vi.mocked(engine.redo).mockRejectedValueOnce(pptxSessionDivergedError(new Error("fmt_no_element")));
    adapter.editor.redo();
    await vi.waitFor(() => expect(adapter.editor.getDirtyGeneration()).toBe(1));
    expect(onDirty).toHaveBeenCalledWith(1);
    expect(adapter.editor.revision()).toBe(viewBefore + 1);

    vi.mocked(engine.undo).mockRejectedValueOnce(pptxSessionDivergedError(new Error("fmt_no_element")));
    adapter.editor.undo();
    await vi.waitFor(() => expect(adapter.editor.getDirtyGeneration()).toBe(2));
    await adapter.editor.dispose();
  });
});
