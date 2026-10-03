// PPTX edit-kind registry tests — P0-1 (UNI-927).
//
// The registry is the extension point the B1..B8 tasks add kinds to: the
// PptxEdit union and the kind → handler table must agree, every registered
// kind must actually dispatch through the model's runTxn seam (one revision
// per applied edit), and an unregistered kind must be refused by code —
// never silently ignored.
import { describe, expect, it } from "vitest";
import { createPptxAdapter, type PptxEdit, pptxEditKinds } from "../src/pptx";
import { createFakePptxEngine, createFakePptxOps } from "./fake-pptx-engine";
import { makeFakePptxBytes, para } from "./fake-pptx-fixtures";

const DECLARED_KINDS = [
  "edit_text",
  "edit_transform",
  "add_element",
  "add_image",
  "replace_picture",
  "move_slide",
  "reorder_element",
  "set_slide_hidden",
  "duplicate_slide",
  "delete_slide",
  "add_blank_slide",
  "add_slide_with_layout",
  "delete_element",
];

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String((error as { code?: string }).code ?? error);
  }
  return "";
};

const openModel = async () => {
  const engine = createFakePptxEngine();
  const adapter = createPptxAdapter({ engine, ops: createFakePptxOps() });
  const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "registry" });
  if (out.outcome !== "opened") throw new Error("open failed");
  return { adapter, ref: out.document_model_ref, model: adapter.sessionOf(out.document_model_ref).model };
};

/** One valid edit per declared kind, in an order the fake deck satisfies. */
const ONE_OF_EACH: PptxEdit[] = [
  { op: "edit_text", slideIndex: 0, elementId: "t1", paragraphs: [para("registry")] },
  { op: "edit_transform", slideIndex: 0, elementId: "s1", xPx: 10, yPx: 10, wPx: 100, hPx: 50 },
  { op: "add_element", slideIndex: 0, kind: "textbox", xPx: 0, yPx: 0, wPx: 100, hPx: 50 },
  { op: "add_image", slideIndex: 0, bytes: new Uint8Array([1]), ext: "png", xPx: 0, yPx: 0, wPx: 10, hPx: 10 },
  { op: "replace_picture", slideIndex: 0, elementId: "p1", bytes: new Uint8Array([2]), ext: "png" },
  { op: "reorder_element", slideIndex: 0, elementId: "t1", dir: "back" },
  { op: "delete_element", slideIndex: 0, elementId: "t1" },
  { op: "set_slide_hidden", slideIndex: 1, hidden: true },
  { op: "duplicate_slide", slideIndex: 0 },
  { op: "delete_slide", slideIndex: 2 },
  { op: "move_slide", slideIndex: 0, toIndex: 1 },
  { op: "add_blank_slide", slideIndex: 0 },
  { op: "add_slide_with_layout", layout: "Title Slide" },
];

describe("pptx edit-kind registry", () => {
  it("registers exactly the declared edit kinds, in registry order", () => {
    expect(pptxEditKinds()).toEqual(DECLARED_KINDS);
    expect(pptxEditKinds().length).toBe(new Set(pptxEditKinds()).size);
    expect(ONE_OF_EACH.map((edit) => edit.op)).toEqual(DECLARED_KINDS);
  });

  it("dispatches every registered kind through the runTxn seam with one revision per edit", async () => {
    const { adapter, ref, model } = await openModel();
    const results = ONE_OF_EACH.map((edit) => adapter.edit(ref, edit));
    expect(results.every((result) => result.applied === true)).toBe(true);
    expect(results.map((result) => result.revision)).toEqual(DECLARED_KINDS.map((_, index) => index + 1));
    expect(model.revision).toBe(DECLARED_KINDS.length);
    expect(model.dirty).toBe(true);
    expect(typeof results[2]?.createdId).toBe("string");
    expect(typeof results[3]?.createdId).toBe("string");
    expect(model.opened.deck.slides[1]?.hidden).toBe(true);
    expect(model.opened.deck.slides.length).toBe(4);
  });

  it("refuses an unregistered kind with a typed error instead of ignoring it", async () => {
    const { model } = await openModel();
    const unregistered = { op: "apply_theme", theme: "Office" } as unknown as PptxEdit;
    expect(errCode(() => model.applyEdit(unregistered))).toBe("unsupported_edit");
    expect(model.revision).toBe(0);
  });
});
