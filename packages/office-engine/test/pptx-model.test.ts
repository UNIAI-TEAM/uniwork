// PPTX model tests — every gesture is a real registry op through runTxn:
// dry-run gate before apply, atomic refusal leaves the deck untouched,
// px→EMU uses the slides-main viewport scale, ordering ops reorder the
// model the save serializes.
import { describe, expect, it } from "vitest";
import {
  createPptxAdapter,
  elementText,
  EMU_PER_PX_96,
  findTextElement,
  makePxToEmu,
} from "../src/pptx";
import { createFakePptxEngine, createFakePptxOps, decodeFakePptx } from "./fake-pptx-engine";
import { makeFakePptxBytes, para } from "./fake-pptx-fixtures";

/** Typed-error oracle: callers branch on `code`, never on message text. */
const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const openModel = async (extra?: Parameters<typeof makeFakePptxBytes>[0]) => {
  const engine = createFakePptxEngine();
  const opened = await engine.openPptx(makeFakePptxBytes(extra));
  const adapter = createPptxAdapter({ engine, ops: createFakePptxOps() });
  // open through the adapter for a real session
  const out = await adapter.open({ bytes: makeFakePptxBytes(extra), format: "pptx", document_id: "d" });
  if (out.outcome !== "opened") throw new Error("open failed");
  const session = adapter.sessionOf(out.document_model_ref);
  return { adapter, ref: out.document_model_ref, model: session.model, opened };
};

describe("pptx helpers", () => {
  it("elementText joins runs; findTextElement targets shape/text only", async () => {
    const { opened } = await openModel();
    const el = findTextElement(opened, 0, "t1");
    expect(el?.id).toBe("t1");
    expect(elementText(el)).toBe("title slide");
    // a picture is never a text target
    expect(findTextElement(opened, 0, "p1")).toBeUndefined();
  });

  it("makePxToEmu scales by deck width at 96 DPI (9525 EMU/px)", async () => {
    const { opened } = await openModel();
    const toEmu = makePxToEmu(opened, 960);
    // deck 9144000 EMU = 960px base width at 96dpi → scale 1 → 1px = 9525
    expect(toEmu(1)).toBe(EMU_PER_PX_96);
    expect(toEmu(10)).toBe(10 * EMU_PER_PX_96);
    const wide = makePxToEmu(opened, 1920);
    expect(wide(10)).toBe(Math.round((10 / 2) * EMU_PER_PX_96));
  });
});

describe("pptx session model ops", () => {
  it("edit_text applies setText on the held deck — the model the save serializes", async () => {
    const { adapter, ref, model } = await openModel();
    adapter.edit(ref, { op: "edit_text", slideIndex: 0, elementId: "t1", paragraphs: [para("EDITED TITLE")] });
    const el = model.opened.deck.slides[0]?.elements.find((e) => e.id === "t1");
    expect(elementText(el)).toBe("EDITED TITLE");
    expect(model.dirty).toBe(true);
    const saved = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
    const pkg = decodeFakePptx(saved.bytes) as unknown as {
      slides: Array<{ elements: Array<{ id: string; text?: { paragraphs: Array<{ runs: Array<{ text: string }> }> } }> }>;
    };
    const savedEl = pkg.slides[0]?.elements.find((e) => e.id === "t1");
    expect(savedEl?.text?.paragraphs[0]?.runs[0]?.text).toBe("EDITED TITLE");
  });

  it("edit_transform converts px to EMU and lands on the element", async () => {
    const { adapter, ref, model } = await openModel();
    adapter.edit(ref, {
      op: "edit_transform",
      slideIndex: 0,
      elementId: "s1",
      xPx: 100,
      yPx: 50,
      wPx: 200,
      hPx: 100,
      rotationDeg: 15,
      fitWidthPx: 960,
    });
    const el = model.opened.deck.slides[0]?.elements.find((e) => e.id === "s1");
    expect(el?.transform?.offset).toEqual({
      x: 100 * EMU_PER_PX_96,
      y: 50 * EMU_PER_PX_96,
      cx: 200 * EMU_PER_PX_96,
      cy: 100 * EMU_PER_PX_96,
    });
    expect(el?.transform?.rot).toBe(15);
  });

  it("a bad op is refused at dry-run and the deck is left untouched (atomic)", async () => {
    const { adapter, ref, model } = await openModel();
    const before = JSON.stringify(model.opened.deck.slides);
    expect(errCode(() =>
      adapter.edit(ref, { op: "edit_transform", slideIndex: 0, elementId: "no-such", xPx: 1, yPx: 1, wPx: 1, hPx: 1 }),
    )).toBe("no_element");
    expect(errCode(() =>
      adapter.edit(ref, { op: "edit_text", slideIndex: 0, elementId: "p1", paragraphs: [para("x")] }),
    )).toBe("no_text_target");
    expect(JSON.stringify(model.opened.deck.slides)).toBe(before);
    expect(model.dirty).toBe(false);
  });

  it("ordering: moveSlide reorders the deck; reorderElement changes z-order", async () => {
    const { adapter, ref, model } = await openModel();
    adapter.edit(ref, { op: "move_slide", slideIndex: 0, toIndex: 1 });
    expect(model.opened.deck.slides[1]?.elements.some((e) => e.id === "t1")).toBe(true);
    adapter.edit(ref, { op: "reorder_element", slideIndex: 1, elementId: "t1", dir: "back" });
    const els = model.opened.deck.slides[1]?.elements.map((e) => e.id);
    expect(els?.[0]).toBe("t1");
  });

  it("slide structure: add/duplicate/delete/hidden mutate slide order", async () => {
    const { adapter, ref, model } = await openModel();
    adapter.edit(ref, { op: "add_slide_with_layout", layout: "Title Slide" });
    expect(model.opened.deck.slides.length).toBe(3);
    adapter.edit(ref, { op: "duplicate_slide", slideIndex: 0 });
    expect(model.opened.deck.slides.length).toBe(4);
    adapter.edit(ref, { op: "set_slide_hidden", slideIndex: 3, hidden: true });
    expect(model.opened.deck.slides[3]?.hidden).toBe(true);
    adapter.edit(ref, { op: "delete_slide", slideIndex: 3 });
    expect(model.opened.deck.slides.length).toBe(3);
  });

  it("add_element/add_image create elements with EMU geometry", async () => {
    const { adapter, ref, model } = await openModel();
    const r = adapter.edit(ref, {
      op: "add_element",
      slideIndex: 1,
      kind: "textbox",
      xPx: 10,
      yPx: 20,
      wPx: 100,
      hPx: 40,
      fitWidthPx: 960,
    });
    const created = model.opened.deck.slides[1]?.elements.find((e) => e.id === (r as { createdId?: string }).createdId);
    expect(created).toBeDefined();
    expect(created?.transform?.offset).toEqual({ x: 10 * EMU_PER_PX_96, y: 20 * EMU_PER_PX_96, cx: 100 * EMU_PER_PX_96, cy: 40 * EMU_PER_PX_96 });
    const r2 = adapter.edit(ref, {
      op: "add_image",
      slideIndex: 1,
      bytes: new Uint8Array([1, 2, 3]),
      ext: "png",
      xPx: 0,
      yPx: 0,
      wPx: 50,
      hPx: 50,
      fitWidthPx: 960,
    });
    const pic = model.opened.deck.slides[1]?.elements.find((e) => e.id === (r2 as { createdId?: string }).createdId);
    expect(pic?.type).toBe("picture");
  });

  it("replace_picture swaps bytes on an existing picture element", async () => {
    const { adapter, ref, model } = await openModel();
    adapter.edit(ref, { op: "replace_picture", slideIndex: 0, elementId: "p1", bytes: new Uint8Array([9]), ext: "png" });
    const el = model.opened.deck.slides[0]?.elements.find((e) => e.id === "p1");
    expect(String(el?.src)).toContain("replaced");
  });

  it("unknown slideIndex => typed no_slide; deck size missing => deck_size_missing", async () => {
    const { adapter, ref } = await openModel();
    expect(errCode(() =>
      adapter.edit(ref, { op: "edit_transform", slideIndex: 9, elementId: "x", xPx: 1, yPx: 1, wPx: 1, hPx: 1 }),
    )).toBe("no_slide");
    const engine = createFakePptxEngine();
    const opened = await engine.openPptx(makeFakePptxBytes({ size: undefined }));
    expect(errCode(() => makePxToEmu(opened, 960))).toBe("deck_size_missing");
  });

  it("session journal records applied ops (model-bound edit trail)", async () => {
    const { adapter, ref, model } = await openModel();
    adapter.edit(ref, { op: "edit_text", slideIndex: 0, elementId: "t1", paragraphs: [para("J")] });
    adapter.edit(ref, { op: "move_slide", slideIndex: 0, toIndex: 1 });
    expect(model.journal.length).toBeGreaterThanOrEqual(2);
    expect(model.revision).toBe(2);
    expect(model.journal.map((r) => r.op.op)).toContain("setText");
    expect(model.journal.map((r) => r.op.op)).toContain("moveSlide");
  });
});
