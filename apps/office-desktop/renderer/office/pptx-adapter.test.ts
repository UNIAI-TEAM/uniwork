/** @vitest-environment node */
// UNI-927 W7: the desktop editor handle forwards the runtime's minted ids and
// layout catalog, and a released session reads empty instead of a freed ref.
import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import type { PptxEdit } from "@uniwork/office-engine/pptx";
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
    serialize: vi.fn(),
    deck: vi.fn(),
    slides: vi.fn(() => []),
    slideLayouts: vi.fn(() => layouts),
    release: vi.fn(async () => undefined),
  } as unknown as PptxSessionRuntime;
}

describe("desktop PPTX adapter handle", () => {
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
});
