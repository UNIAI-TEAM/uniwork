// A6ui (UNI-927) - pure find/replace model tests.
//
// The panel's navigation and the exact edits it emits are pinned here without a
// DOM: the count comes from the committed engine `planFindReplace` helper, so a
// drift between the dialog's number and the op's behaviour fails loudly.
import { describe, expect, it } from "vitest";
import {
  PPTX_FIND_UNSET_HIT,
  activeHitTarget,
  clampHitIndex,
  planFind,
  replaceAllEdit,
  replaceOneEdit,
  stepHitIndex,
  type PptxFindTextTarget,
} from "./pptx-find-model";

const targets: PptxFindTextTarget[] = [
  { text: "Alpha slide", slideIndex: 0, elementId: "t1" },
  { text: "no match here", slideIndex: 0, elementId: "t2" },
  { text: "another slide", slideIndex: 1, elementId: "t3" },
  { text: "SLIDE upper", slideIndex: 1, elementId: "t4" },
];

describe("planFind", () => {
  it("counts every occurrence case-insensitively by default", () => {
    const plan = planFind(targets, "slide", false);
    // alpha slide, another slide, SLIDE upper
    expect(plan.total).toBe(3);
    expect(plan.hits.map((hit) => hit.index)).toEqual([1, 3, 4]);
  });

  it("counts one occurrence per run when matchCase is on", () => {
    const plan = planFind(targets, "SLIDE", true);
    expect(plan.total).toBe(1);
    expect(plan.hits).toEqual([{ index: 4, count: 1 }]);
  });

  it("counts nothing for an empty query", () => {
    expect(planFind(targets, "", false)).toEqual({ total: 0, replaceCount: 0, hits: [] });
  });

  it("counts multiple occurrences inside one run", () => {
    const plan = planFind([{ text: "slide slide", slideIndex: 0 }], "slide", false);
    expect(plan.total).toBe(2);
    expect(plan.hits).toEqual([{ index: 1, count: 2 }]);
  });
});

describe("hit navigation", () => {
  it("clamps into range and reports unset when there are no hits", () => {
    expect(clampHitIndex(-1, 3)).toBe(0);
    expect(clampHitIndex(9, 3)).toBe(2);
    expect(clampHitIndex(0, 0)).toBe(PPTX_FIND_UNSET_HIT);
  });

  it("steps and wraps in both directions", () => {
    expect(stepHitIndex(0, 3, 1)).toBe(1);
    expect(stepHitIndex(2, 3, 1)).toBe(0);
    expect(stepHitIndex(0, 3, -1)).toBe(2);
    expect(stepHitIndex(PPTX_FIND_UNSET_HIT, 3, 1)).toBe(0);
    expect(stepHitIndex(PPTX_FIND_UNSET_HIT, 3, -1)).toBe(2);
    expect(stepHitIndex(0, 0, 1)).toBe(PPTX_FIND_UNSET_HIT);
  });

  it("resolves the target under the active hit", () => {
    const plan = planFind(targets, "slide", false);
    expect(activeHitTarget(targets, plan, 0)?.elementId).toBe("t1");
    expect(activeHitTarget(targets, plan, 2)?.elementId).toBe("t4");
    expect(activeHitTarget(targets, plan, 99)).toBeNull();
  });
});

describe("emitted edits", () => {
  it("builds the deck-wide replace-all edit", () => {
    expect(replaceAllEdit("slide", "deck", true)).toEqual({
      op: "find_replace",
      find: "slide",
      replace: "deck",
      matchCase: true,
    });
    expect(replaceAllEdit("", "deck", false)).toBeNull();
  });

  it("scopes replace-one to the hit element and caps it at one match", () => {
    const plan = planFind(targets, "slide", false);
    expect(replaceOneEdit(targets, plan, 1, "slide", "deck", false)).toEqual({
      op: "find_replace",
      find: "slide",
      replace: "deck",
      matchCase: false,
      firstOnly: true,
      slideIndex: 1,
      elementId: "t3",
    });
  });

  it("omits the element id when the target has none", () => {
    const bare: PptxFindTextTarget[] = [{ text: "slide", slideIndex: 2 }];
    const plan = planFind(bare, "slide", false);
    expect(replaceOneEdit(bare, plan, 0, "slide", "deck", false)).toEqual({
      op: "find_replace",
      find: "slide",
      replace: "deck",
      matchCase: false,
      firstOnly: true,
      slideIndex: 2,
    });
  });

  it("emits no replace-one edit without a hit", () => {
    const plan = planFind(targets, "zzz", false);
    expect(replaceOneEdit(targets, plan, 0, "zzz", "x", false)).toBeNull();
  });
});
