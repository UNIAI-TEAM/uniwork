/** @vitest-environment node */
// UNI-927 W7: the desktop runtime drives the REAL PptxAdapter/PptxSessionModel
// (only the generated pptx artifact is stubbed with the office-engine fakes),
// so the edit channel's minted ids and the layout read are proven end to end.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedPptxLike, PptxEdit, PptxTxnRequest } from "@uniwork/office-engine/pptx";
import { makeFakePptxBytes } from "../../../../packages/office-engine/test/fake-pptx-fixtures";
import { registerReplayIdScenarios, registerSaveRebaseScenarios } from "../../../../packages/office-engine/test/pptx-replay-scenarios";
import { createWebPptxSessionRuntime, type PptxSessionRuntime } from "./pptx-runtime";

// W12 real-id mode (packages/office-engine/test/pptx-replay-scenarios.ts).
const seam = vi.hoisted(() => ({ realIds: false, breakOp: null as string | null, saves: 0, opens: 0 }));

vi.mock("@uniwork/office-upstream/pptx-renderer", async () => {
  const fakes = await import("../../../../packages/office-engine/test/fake-pptx-engine");
  const engine = fakes.createFakePptxEngine();
  const ops = fakes.createFakePptxOps();
  const { remintElementIds: remint } = await import("../../../../packages/office-engine/test/pptx-replay-scenarios");
  return {
    openPptx: async (bytes: Uint8Array) => {
      const opened = await engine.openPptx(bytes);
      seam.opens += 1;
      if (seam.realIds) remint(opened.deck as never, "o" + String(seam.opens));
      return opened;
    },
    savePptx: (opened: OpenedPptxLike) => {
      seam.saves += 1;
      return engine.savePptx(opened);
    },
    commitSaved: (opened: OpenedPptxLike) => engine.commitSaved?.(opened),
    reparseDeck: (opened: OpenedPptxLike) => engine.reparseDeck?.(opened) ?? opened,
    listSlideLayouts: (archive: unknown) => engine.listSlideLayouts?.(archive) ?? [],
    runTxn: (opened: OpenedPptxLike, request: PptxTxnRequest) => {
      if (request.dryRun !== true && seam.breakOp && request.ops.some((op) => op.op === seam.breakOp)) throw new Error("forced replay failure");
      return ops.runTxn(opened, request);
    },
    getSlideNotes: () => "",
    buildRenderSlide: () => ({ nodes: [] }),
    HeuristicMetrics: class HeuristicMetrics {},
  };
});

const box = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 1, wPx: 10, hPx: 10 });
const hide = (hidden: boolean): PptxEdit => ({ op: "set_slide_hidden", slideIndex: 0, hidden });
const slideHidden = (slideIndex: number, value: boolean): PptxEdit => ({ op: "set_slide_hidden", slideIndex, hidden: value });

async function opened(): Promise<{ runtime: PptxSessionRuntime; ref: string }> {
  const runtime = createWebPptxSessionRuntime({ documentId: "doc" });
  const result = await runtime.open({ bytes: makeFakePptxBytes(), documentId: "doc" });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("open failed");
  return { runtime, ref: result.document_model_ref };
}

beforeEach(() => {
  seam.realIds = false;
  seam.breakOp = null;
});

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

  // X1: the panel reads go to the live engine session (real round trips:
  // apps/web/platform/office/pptx-runtime.real.test.ts on the mirrored runtime).
  it("reads a live slide's transition and animations, refusing a missing slide and after release", async () => {
    const { runtime, ref } = await opened();
    expect(runtime.slideTransition!(ref, 0)).toEqual({ kind: "none", advanceMs: null });
    expect(runtime.slideAnimations!(ref, 0)).toEqual([]);
    expect(() => runtime.slideTransition!(ref, 42)).toThrow(/slide index 42/);
    await runtime.release(ref);
    expect(() => runtime.slideTransition!(ref, 0)).toThrow("pptx_runtime_not_open");
    expect(() => runtime.slideAnimations!(ref, 0)).toThrow("pptx_runtime_not_open");
  });

  // UNI-927 W11a (W10 review F1): a multi-entry edit() is all-or-nothing and
  // one history step.
  it("rolls a batch refused mid-array back so save, undo and redo still agree", async () => {
    const { runtime, ref } = await opened();
    // "t1" is the base deck's text element, so its id is stable across replays.
    const created = "t1";
    await runtime.edit(ref, [{ op: "set_notes", slideIndex: 0, text: "kept" }]);
    await runtime.edit(ref, [{ op: "delete_element", slideIndex: 0, elementId: created }]);
    await runtime.edit(ref, [slideHidden(1, true)]);
    expect(await runtime.undo(ref)).toBe(true);
    const before = runtime.snapshot(ref);
    expect(before.revision).toBe(2);

    // The 2nd entry targets the element deleted between selection and apply.
    const refused = runtime.edit(ref, [
      slideHidden(0, true),
      { op: "set_text_anchor", slideIndex: 0, elementId: created, anchor: "middle" },
      slideHidden(1, true),
    ]);
    await expect(refused).rejects.toMatchObject({ code: "fmt_no_element" });

    // No trace: journal, cursor, revision and the live model are the pre-call state.
    expect(runtime.snapshot(ref)).toEqual(before);
    expect(runtime.slides(ref)[0]?.hidden).toBe(false);
    expect(runtime.slides(ref)[1]?.hidden).toBe(false);
    const saved = await runtime.serialize(ref, { snapshot: { generation: 2, fingerprint: "fp", value: runtime.snapshot(ref) } });
    expect(saved.bytes.length).toBeGreaterThan(0);
    // The refused gesture did not drop the redo tail.
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.slides(ref)[1]?.hidden).toBe(true);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual(before);

    // A following valid batch lands, is one undo step, and redo replays it whole.
    expect(await runtime.edit(ref, [slideHidden(0, true), slideHidden(1, true)])).toEqual({ revision: 4 });
    expect(runtime.snapshot(ref).edits).toHaveLength(4);
    expect(await runtime.redo(ref)).toBe(false);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual(before);
    expect(runtime.slides(ref)[0]?.hidden).toBe(false);
    expect(await runtime.redo(ref)).toBe(true);
    expect(runtime.snapshot(ref).revision).toBe(4);
    expect(runtime.slides(ref).map((slide) => slide.hidden)).toEqual([true, true]);
    const tip = runtime.snapshot(ref);
    await expect(runtime.serialize(ref, { snapshot: { generation: 4, fingerprint: "fp", value: tip } })).resolves.toBeDefined();
  });

  it("leaves the session untouched when the first entry of a batch is refused", async () => {
    const { runtime, ref } = await opened();
    await runtime.edit(ref, [slideHidden(0, true)]);
    const before = runtime.snapshot(ref);
    await expect(runtime.edit(ref, [{ op: "set_text_anchor", slideIndex: 0, elementId: "gone", anchor: "top" }, slideHidden(1, true)]))
      .rejects.toMatchObject({ code: "fmt_no_element" });
    expect(runtime.snapshot(ref)).toEqual(before);
    expect(runtime.slides(ref)[1]?.hidden).toBe(false);
    expect(await runtime.undo(ref)).toBe(true);
    expect(runtime.snapshot(ref)).toEqual({ revision: 0, edits: [] });
  });
});

describe("desktop PPTX session runtime - replay-stable ids (W12)", () => {
  registerReplayIdScenarios(seam, opened);
});

async function openedOn(onBytes: Uint8Array = makeFakePptxBytes()): Promise<{ runtime: PptxSessionRuntime; ref: string }> {
  const runtime = createWebPptxSessionRuntime({ documentId: "doc" });
  const result = await runtime.open({ bytes: onBytes, documentId: "doc" });
  if (result.outcome !== "opened" || !result.document_model_ref) throw new Error("open failed");
  return { runtime, ref: result.document_model_ref };
}

describe("desktop PPTX session runtime - save-point rebase (W14)", () => {
  registerSaveRebaseScenarios(seam, openedOn);
});
