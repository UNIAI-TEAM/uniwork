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
  findOccurrences,
  flattenDeckRuns,
  planFind,
  replaceAllEdit,
  replaceOneEdit,
  resumeHitIndex,
  resumePositionAfterReplace,
  stepHitIndex,
  type PptxFindOccurrence,
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
    const hits = findOccurrences(targets, "slide", false);
    expect(activeHitTarget(hits, 0)?.elementId).toBe("t1");
    expect(activeHitTarget(hits, 2)?.elementId).toBe("t4");
    expect(activeHitTarget(hits, 99)).toBeNull();
  });
});

describe("findOccurrences (R3 F-1: a hit is one occurrence, not one run)", () => {
  it("lists every occurrence inside one run, with its offset", () => {
    const single: PptxFindTextTarget[] = [{ text: "alpha beta alpha", slideIndex: 0, elementId: "t1" }];
    expect(findOccurrences(single, "alpha", false)).toEqual<PptxFindOccurrence[]>([
      { run: 0, offset: 0, length: 5, slideIndex: 0, elementId: "t1" },
      { run: 0, offset: 11, length: 5, slideIndex: 0, elementId: "t1" },
    ]);
  });

  it("agrees with the engine plan's total, case-folded unless matchCase", () => {
    const runs: PptxFindTextTarget[] = [
      { text: "Go go GO", slideIndex: 0, elementId: "t1" },
      { text: "gogo", slideIndex: 1 },
    ];
    expect(findOccurrences(runs, "go", false)).toHaveLength(planFind(runs, "go", false).total);
    expect(findOccurrences(runs, "go", false).map((hit) => [hit.run, hit.offset])).toEqual([[0, 0], [0, 3], [0, 6], [1, 0], [1, 2]]);
    expect(findOccurrences(runs, "GO", true).map((hit) => [hit.run, hit.offset])).toEqual([[0, 6]]);
  });

  it("matches non-overlapping, literally (metacharacters are text)", () => {
    expect(findOccurrences([{ text: "aaaa", slideIndex: 0 }], "aa", false).map((hit) => hit.offset)).toEqual([0, 2]);
    expect(findOccurrences([{ text: "a.b axb a.b", slideIndex: 0 }], "a.b", false).map((hit) => hit.offset)).toEqual([0, 8]);
  });

  it("finds nothing for an empty query", () => {
    expect(findOccurrences(targets, "", false)).toEqual([]);
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
    const hits = findOccurrences(targets, "slide", false);
    expect(replaceOneEdit(hits, 1, "slide", "deck", false)).toEqual({
      op: "find_replace",
      find: "slide",
      replace: "deck",
      matchCase: false,
      firstOnly: true,
      slideIndex: 1,
      elementId: "t3",
      occurrence: 0,
    });
  });

  it("carries the hit's ordinal inside its element, so a later run of the same element is the one replaced", () => {
    const runs: PptxFindTextTarget[] = [
      { text: "go west", slideIndex: 0, elementId: "t1" },
      { text: "nothing", slideIndex: 0, elementId: "t1" },
      { text: "go go", slideIndex: 0, elementId: "t1" },
      { text: "go on", slideIndex: 0, elementId: "t2" },
      { text: "go home", slideIndex: 1, elementId: "t1" },
    ];
    const hits = findOccurrences(runs, "go", false);
    const ordinal = (hitIndex: number) => replaceOneEdit(hits, hitIndex, "go", "X", false)?.occurrence;
    // t1 on slide 0 holds three matches over two runs, each its own hit.
    expect(hits).toHaveLength(5);
    expect([0, 1, 2, 3, 4].map(ordinal)).toEqual([0, 1, 2, 0, 0]);
    expect(replaceOneEdit(hits, 2, "go", "X", false)).toMatchObject({ slideIndex: 0, elementId: "t1", occurrence: 2 });
  });

  it("targets the second occurrence of one run alone (R3 F-1)", () => {
    const single: PptxFindTextTarget[] = [{ text: "alpha beta alpha", slideIndex: 0, elementId: "t1" }];
    const hits = findOccurrences(single, "alpha", false);
    expect(replaceOneEdit(hits, 0, "alpha", "GAMMA", false)).toMatchObject({ elementId: "t1", occurrence: 0 });
    expect(replaceOneEdit(hits, 1, "alpha", "GAMMA", false)).toMatchObject({ elementId: "t1", occurrence: 1, firstOnly: true });
  });

  it("omits the element id when the target has none", () => {
    const bare: PptxFindTextTarget[] = [{ text: "slide", slideIndex: 2 }];
    const hits = findOccurrences(bare, "slide", false);
    expect(replaceOneEdit(hits, 0, "slide", "deck", false)).toEqual({
      op: "find_replace",
      find: "slide",
      replace: "deck",
      matchCase: false,
      firstOnly: true,
      slideIndex: 2,
    });
  });

  it("emits no replace-one edit without a hit", () => {
    expect(replaceOneEdit(findOccurrences(targets, "zzz", false), 0, "zzz", "x", false)).toBeNull();
  });
});

describe("replace-one resume (the active hit moves past the text just written)", () => {
  // Apply the one-occurrence replace to a run, the way the engine does.
  const apply = (runs: PptxFindTextTarget[], hits: PptxFindOccurrence[], at: number, replacement: string): PptxFindTextTarget[] => {
    const hit = hits[at]!;
    return runs.map((run, index) =>
      index === hit.run
        ? { ...run, text: run.text.slice(0, hit.offset) + replacement + run.text.slice(hit.offset + hit.length) }
        : run,
    );
  };

  it("never lands back on the text it wrote: replacing a with aa walks forward through the run", () => {
    let runs: PptxFindTextTarget[] = [{ text: "banana", slideIndex: 0, elementId: "t1" }];
    let hits = findOccurrences(runs, "a", false);
    let at = 0;
    const visited: number[] = [];
    for (let step = 0; step < 2; step += 1) {
      const hit = hits[at]!;
      const position = resumePositionAfterReplace(hits, at, runs, "aa");
      runs = apply(runs, hits, at, "aa");
      hits = findOccurrences(runs, "a", false);
      at = resumeHitIndex(hits, position);
      visited.push(hit.offset);
      // The new active hit is strictly after the text just written.
      expect(hits[at]!.offset).toBeGreaterThanOrEqual(hit.offset + 2);
    }
    expect(runs[0]!.text).toBe("baanaana");
    expect(visited).toEqual([1, 4]);
  });

  it("moves to the next run when the written text was the run's last match", () => {
    const runs: PptxFindTextTarget[] = [
      { text: "a", slideIndex: 0, elementId: "t1" },
      { text: "ba", slideIndex: 1, elementId: "t2" },
    ];
    const hits = findOccurrences(runs, "a", false);
    const position = resumePositionAfterReplace(hits, 0, runs, "aa");
    const nextHits = findOccurrences(apply(runs, hits, 0, "aa"), "a", false);
    expect(nextHits[resumeHitIndex(nextHits, position)]).toMatchObject({ run: 1, offset: 1 });
  });

  it("wraps to the first hit when nothing remains after the written text", () => {
    const runs: PptxFindTextTarget[] = [{ text: "aXa", slideIndex: 0, elementId: "t1" }];
    const hits = findOccurrences(runs, "a", false);
    const position = resumePositionAfterReplace(hits, 1, runs, "aa");
    const nextHits = findOccurrences(apply(runs, hits, 1, "aa"), "a", false);
    expect(resumeHitIndex(nextHits, position)).toBe(0);
  });

  it("follows a run that vanished (replaced with nothing) to the run now in its place", () => {
    const runs: PptxFindTextTarget[] = [
      { text: "a", slideIndex: 0, elementId: "t1" },
      { text: "a", slideIndex: 0, elementId: "t2" },
    ];
    const hits = findOccurrences(runs, "a", false);
    const position = resumePositionAfterReplace(hits, 0, runs, "");
    // The emptied run is dropped from the flattened deck, so t2 is now run 0.
    const nextHits = findOccurrences([runs[1]!], "a", false);
    expect(nextHits[resumeHitIndex(nextHits, position)]).toMatchObject({ run: 0, offset: 0 });
  });

  it("reports unset when there are no hits left", () => {
    expect(resumeHitIndex([], { run: 0, offset: 0 })).toBe(PPTX_FIND_UNSET_HIT);
  });
});

describe("flattenDeckRuns", () => {
  const para = (...texts: string[]) => ({ paragraphs: [{ runs: texts.map((text) => ({ text })) }] });
  const deck = {
    slides: [
      {
        elements: [
          { id: "t1", type: "text", text: para("Hello ", "world") },
          { id: "p1", type: "picture" },
          { id: "f1", type: "shape", text: { paragraphs: [{ runs: [{ text: "5", field: "slidenum" }, { text: "" }, { text: "kept" }] }] } },
          {
            id: "tbl",
            type: "table",
            rows: [[{ text: para("cell a") }, { merged: true, text: para("hidden") }], [{ text: para("cell b") }]],
          },
          { id: "grp", type: "group", children: [{ id: "c1", type: "text", text: para("child") }, { id: "c2", type: "picture" }] },
        ],
      },
      { elements: [{ id: "t1", type: "text", text: para("second slide") }] },
    ],
  };

  it("lists one entry per run in the replace order, skipping field and empty runs", () => {
    expect(flattenDeckRuns(deck)).toEqual([
      { text: "Hello ", slideIndex: 0, elementId: "t1" },
      { text: "world", slideIndex: 0, elementId: "t1" },
      { text: "kept", slideIndex: 0, elementId: "f1" },
      { text: "cell a", slideIndex: 0, elementId: "tbl" },
      { text: "cell b", slideIndex: 0, elementId: "tbl" },
      { text: "child", slideIndex: 0, elementId: "grp" },
      { text: "second slide", slideIndex: 1, elementId: "t1" },
    ]);
  });

  it("degrades to nothing on a deck of an unexpected shape", () => {
    for (const bad of [null, undefined, 3, {}, { slides: "x" }, { slides: [null, { elements: 4 }, { elements: [null, 1, { type: "table", rows: [3] }] }] }]) {
      expect(flattenDeckRuns(bad)).toEqual([]);
    }
  });
});
