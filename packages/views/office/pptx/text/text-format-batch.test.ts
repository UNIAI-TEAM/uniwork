import { describe, expect, it } from "vitest";
import { buildPptxTextEditBatch } from "./text-format-batch";
import { buildFontToggleEdit } from "./text-format-model";

describe("buildPptxTextEditBatch (UNI-927 W10a)", () => {
  const bold = (id: string) => buildFontToggleEdit(0, id, "bold", true);

  it("builds one edit per id in order, anchor first", () => {
    const { edits, refusal } = buildPptxTextEditBatch("a", ["a", "b", "c"], bold);
    expect(edits.map((edit) => edit.elementId)).toEqual(["a", "b", "c"]);
    expect(refusal).toBeNull();
  });

  it("falls back to the anchor when no ids are given, and builds nothing without one", () => {
    expect(buildPptxTextEditBatch("a", [], bold).edits.map((edit) => edit.elementId)).toEqual(["a"]);
    expect(buildPptxTextEditBatch("a", undefined, bold).edits).toHaveLength(1);
    expect(buildPptxTextEditBatch(null, undefined, bold)).toEqual({ edits: [], refusal: null });
  });

  it("skips refused ids and keeps only the first refusal", () => {
    const first = new Error("first");
    const { edits, refusal } = buildPptxTextEditBatch("a", ["a", "b", "c"], (id) => {
      if (id === "b") throw first;
      if (id === "c") throw new Error("second");
      return bold(id);
    });
    expect(edits.map((edit) => edit.elementId)).toEqual(["a"]);
    expect(refusal).toBe(first);
  });
});
