import { describe, expect, it } from "vitest";
import type { PptxNodeBox } from "../canvas/render-tree";
import { box } from "../canvas/pptx-render-fixtures";
import { EMPTY_SELECTION, pruneSelection, selectAt, selectionHas, setSelection } from "./selection-model";

describe("selection model", () => {
  it("replaces the selection on a plain click and clears on empty canvas", () => {
    expect(selectAt(EMPTY_SELECTION, "a", false)).toEqual({ ids: ["a"] });
    expect(selectAt({ ids: ["a", "b"] }, "c", false)).toEqual({ ids: ["c"] });
    expect(selectAt({ ids: ["a"] }, null, false)).toEqual({ ids: [] });
    expect(selectAt({ ids: ["a"] }, null, true)).toEqual({ ids: ["a"] });
  });

  it("keeps the same ids reference when a plain click re-selects the only element", () => {
    const state = { ids: ["a"] as const };
    // The documented shape is the state object ({ ids }), the same shape every
    // other assertion here uses; the reference that must stay stable is the
    // ids array inside it.
    expect(selectAt(state, "a", false)).toEqual({ ids: ["a"] });
    expect(selectAt(state, "a", false).ids).toBe(state.ids);
  });

  it("toggles with shift-click", () => {
    expect(selectAt({ ids: ["a"] }, "b", true)).toEqual({ ids: ["a", "b"] });
    expect(selectAt({ ids: ["a", "b"] }, "a", true)).toEqual({ ids: ["b"] });
  });

  it("deduplicates a programmatic selection and reports membership", () => {
    expect(setSelection(["a", "a", "b"])).toEqual({ ids: ["a", "b"] });
    expect(selectionHas({ ids: ["a"] }, "a")).toBe(true);
    expect(selectionHas({ ids: ["a"] }, "b")).toBe(false);
  });

  it("prunes ids that no longer exist and keeps the original order", () => {
    const boxes: PptxNodeBox[] = [
      { sourceId: "b", type: "shape", box: box() },
      { sourceId: "a", type: "shape", box: box() },
    ];
    expect(pruneSelection({ ids: ["a", "gone", "b"] }, boxes)).toEqual({ ids: ["a", "b"] });
    const stable = { ids: ["a"] as const };
    expect(pruneSelection(stable, boxes)).toBe(stable);
  });
});
