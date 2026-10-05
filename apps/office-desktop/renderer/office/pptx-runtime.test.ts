/** @vitest-environment node */
// UNI-927 W7: the desktop runtime drives the REAL PptxAdapter/PptxSessionModel
// (only the generated pptx artifact is stubbed with the office-engine fakes),
// so the edit channel's minted ids and the layout read are proven end to end.
import { describe, expect, it, vi } from "vitest";
import type { OpenedPptxLike, PptxEdit, PptxTxnRequest } from "@uniwork/office-engine/pptx";
import { makeFakePptxBytes } from "../../../../packages/office-engine/test/fake-pptx-fixtures";
import { createWebPptxSessionRuntime, type PptxSessionRuntime } from "./pptx-runtime";

vi.mock("@uniwork/office-upstream/pptx-renderer", async () => {
  const fakes = await import("../../../../packages/office-engine/test/fake-pptx-engine");
  const engine = fakes.createFakePptxEngine();
  const ops = fakes.createFakePptxOps();
  return {
    openPptx: (bytes: Uint8Array) => engine.openPptx(bytes),
    savePptx: (opened: OpenedPptxLike) => engine.savePptx(opened),
    commitSaved: (opened: OpenedPptxLike) => engine.commitSaved?.(opened),
    reparseDeck: (opened: OpenedPptxLike) => engine.reparseDeck?.(opened) ?? opened,
    listSlideLayouts: (archive: unknown) => engine.listSlideLayouts?.(archive) ?? [],
    runTxn: (opened: OpenedPptxLike, request: PptxTxnRequest) => ops.runTxn(opened, request),
    getSlideNotes: () => "",
    buildRenderSlide: () => ({ nodes: [] }),
    HeuristicMetrics: class HeuristicMetrics {},
  };
});

const box = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 1, wPx: 10, hPx: 10 });
const hide = (hidden: boolean): PptxEdit => ({ op: "set_slide_hidden", slideIndex: 0, hidden });

async function opened(): Promise<{ runtime: PptxSessionRuntime; ref: string }> {
  const runtime = createWebPptxSessionRuntime({ documentId: "doc" });
  const result = await runtime.open({ bytes: makeFakePptxBytes(), documentId: "doc" });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("open failed");
  return { runtime, ref: result.document_model_ref };
}

describe("desktop PPTX session runtime", () => {
  it("returns the minted element ids from the edit channel, and none for non-creating edits", async () => {
    const { runtime, ref } = await opened();
    const one = await runtime.edit(ref, [box(1)]);
    expect(one.revision).toBe(1);
    expect(one.createdIds).toHaveLength(1);
    expect(runtime.slides(ref)[0]?.elements.some((element) => element.id === one.createdIds![0])).toBe(true);
    const mixed = await runtime.edit(ref, [hide(true), box(2), box(3)]);
    expect(mixed.createdIds).toHaveLength(2);
    expect(await runtime.edit(ref, [hide(false)])).toEqual({ revision: 5 });
  });

  it("reads the live package's slide layouts and refuses after release", async () => {
    const { runtime, ref } = await opened();
    expect(runtime.slideLayouts!(ref)).toEqual([{ name: "Title Slide", path: "ppt/slideLayouts/slideLayout1.xml" }]);
    await runtime.release(ref);
    expect(() => runtime.slideLayouts!(ref)).toThrow("pptx_runtime_not_open");
  });
});
