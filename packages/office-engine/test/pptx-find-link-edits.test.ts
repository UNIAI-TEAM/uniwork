// A6e (UNI-927) — find & replace + hyperlink edit-builder tests.
//
// Vendored guard first: every op these builders can emit must exist in the
// vendored pptx-ops sources as `name: '<op>'`, and the exported action list
// must equal the vendored NAMED_ACTIONS. Op objects are compared strictly
// (absent optionals stay absent), refusals branch on typed PptxEngineError
// codes, and the pure helpers mirror replaceAllInDeck (engine index.ts:3031).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFindLinkOps,
  countFindMatches,
  planFindReplace,
  PPTX_NAMED_ACTIONS,
  type FindLinkEdit,
  type OpenedPptxLike,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

/** Plain deck fixture: two slides, a text + picture on slide 0, a shape on
 * slide 1 — enough for slide-exists and element-exists validation. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      {
        id: "s1",
        elements: [
          { id: "t1", type: "text", text: { paragraphs: [{ runs: [{ text: "title slide" }] }] } },
          { id: "p1", type: "picture" },
        ],
      },
      {
        id: "s2",
        elements: [{ id: "t2", type: "shape", text: { paragraphs: [{ runs: [{ text: "second slide" }] }] } }],
      },
    ],
  },
};

const build = (edit: FindLinkEdit) => buildFindLinkOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

describe("find/link vendored guard", () => {
  it("emits only op names registered in the vendored pptx-ops sources", () => {
    const slideOps = readVendored("pptx-ops/src/ops/slide-ops.ts");
    const elementOps = readVendored("pptx-ops/src/ops/element-ops.ts");
    // The exact registry lines A6e binds to (slide-ops.ts:583, element-ops.ts:558).
    expect(slideOps).toContain("name: 'findReplace'");
    expect(elementOps).toContain("name: 'setLink'");
    // setLink validates through the shared link guard (element-ops.ts:560).
    expect(elementOps).toContain("requireLinkTarget('setLink', op.link)");
  });

  it("pins the exported action list to the vendored NAMED_ACTIONS", () => {
    const source = readVendored("pptx-engine/src/named-action.ts");
    const body = source.match(/NAMED_ACTIONS = \[([\s\S]*?)\]\s+as const/)?.[1] ?? "";
    const vendored = Array.from(body.matchAll(/'([a-z]+)'/g), (match) => match[1]);
    expect(vendored).toEqual([...PPTX_NAMED_ACTIONS]);
  });
});

describe("find_replace op building", () => {
  it("builds the exact full-option findReplace op", () => {
    expect(
      build({
        op: "find_replace",
        find: "slide",
        replace: "deck",
        matchCase: true,
        firstOnly: true,
        slideIndex: 1,
        elementId: "t2",
      }),
    ).toStrictEqual([
      {
        op: "findReplace",
        find: "slide",
        replace: "deck",
        matchCase: true,
        firstOnly: true,
        slideIndex: 1,
        elementId: "t2",
      },
    ]);
  });

  it("omits every optional field that was not supplied", () => {
    const [op] = build({ op: "find_replace", find: "a", replace: "b" });
    expect(op).toStrictEqual({ op: "findReplace", find: "a", replace: "b" });
  });

  it("keeps explicit false flags and an empty replacement", () => {
    const [op] = build({ op: "find_replace", find: "a", replace: "", matchCase: false, firstOnly: false });
    expect(op).toStrictEqual({ op: "findReplace", find: "a", replace: "", matchCase: false, firstOnly: false });
  });
});

describe("set_link op building", () => {
  it("builds the exact setLink op for a url target", () => {
    expect(build({ op: "set_link", slideIndex: 1, elementId: "t2", link: { kind: "url", url: "https://example.com" } }))
      .toStrictEqual([
        {
          op: "setLink",
          target: { slide: 1, el: "t2" },
          link: { kind: "url", url: "https://example.com" },
        },
      ]);
  });

  it("builds slide-jump, named-action and removal targets", () => {
    expect(build({ op: "set_link", slideIndex: 0, elementId: "t1", link: { kind: "slide", slideIndex: 1 } })[0]).toStrictEqual({
      op: "setLink",
      target: { slide: 0, el: "t1" },
      link: { kind: "slide", slideIndex: 1 },
    });
    expect(build({ op: "set_link", slideIndex: 0, elementId: "t1", link: { kind: "action", action: "nextslide" } })[0]).toStrictEqual({
      op: "setLink",
      target: { slide: 0, el: "t1" },
      link: { kind: "action", action: "nextslide" },
    });
    expect(build({ op: "set_link", slideIndex: 0, elementId: "t1", link: null })[0]).toStrictEqual({
      op: "setLink",
      target: { slide: 0, el: "t1" },
      link: null,
    });
  });
});

describe("find/link refusals", () => {
  it("refuses an empty or missing find term with bad_find", () => {
    expect(errCode(() => build({ op: "find_replace", find: "", replace: "x" }))).toBe("bad_find");
    expect(errCode(() => build({ op: "find_replace", replace: "x" } as unknown as FindLinkEdit))).toBe("bad_find");
  });

  it("refuses a missing replacement with bad_replace", () => {
    expect(errCode(() => build({ op: "find_replace", find: "x" } as unknown as FindLinkEdit))).toBe("bad_replace");
    expect(errCode(() => build({ op: "find_replace", find: "x", replace: 7 } as unknown as FindLinkEdit))).toBe("bad_replace");
  });

  it("refuses a slide index that does not exist with no_slide", () => {
    expect(errCode(() => build({ op: "find_replace", find: "x", replace: "y", slideIndex: 9 }))).toBe("no_slide");
    expect(errCode(() => build({ op: "find_replace", find: "x", replace: "y", slideIndex: -1 }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_link", slideIndex: 9, elementId: "t1", link: null }))).toBe("no_slide");
  });

  it("refuses a missing set_link element with no_element", () => {
    expect(errCode(() => build({ op: "set_link", slideIndex: 0, elementId: "missing", link: null }))).toBe("no_element");
  });

  it("refuses invalid link shapes with bad_link", () => {
    const linkEdit = (link: unknown): FindLinkEdit =>
      ({ op: "set_link", slideIndex: 0, elementId: "t1", link }) as FindLinkEdit;
    expect(errCode(() => build(linkEdit(undefined)))).toBe("bad_link");
    expect(errCode(() => build(linkEdit("https://example.com")))).toBe("bad_link");
    expect(errCode(() => build(linkEdit({ kind: "url", url: "" })))).toBe("bad_link");
    expect(errCode(() => build(linkEdit({ kind: "slide", slideIndex: -1 })))).toBe("bad_link");
    expect(errCode(() => build(linkEdit({ kind: "slide", slideIndex: 1.5 })))).toBe("bad_link");
    expect(errCode(() => build(linkEdit({ kind: "action", action: "jump" })))).toBe("bad_link");
    expect(errCode(() => build(linkEdit({ kind: "mailto", url: "a@b.c" })))).toBe("bad_link");
  });
});

describe("pure find/replace helpers", () => {
  const texts = ["Slide one and slide two", "SLIDE three", "nothing here"];

  it("counts non-overlapping matches across texts, case-insensitively by default", () => {
    expect(countFindMatches(texts, "slide")).toBe(3);
    expect(countFindMatches(texts, "Slide")).toBe(3);
  });

  it("honours matchCase and treats the term as a literal", () => {
    expect(countFindMatches(texts, "slide", true)).toBe(1);
    expect(countFindMatches(["a.b a_b", "a.b"], "a.b")).toBe(2);
    expect(countFindMatches(["1+1 = 2", "1+1"], "1+1")).toBe(2);
    expect(countFindMatches(["x"], "(x)")).toBe(0);
  });

  it("counts nothing for an empty term or no match", () => {
    expect(countFindMatches(texts, "")).toBe(0);
    expect(countFindMatches(texts, "absent")).toBe(0);
  });

  it("plans match hits and the firstOnly replacement budget", () => {
    expect(planFindReplace(texts, "slide")).toStrictEqual({
      total: 3,
      replaceCount: 3,
      hits: [
        { index: 1, count: 2 },
        { index: 2, count: 1 },
      ],
    });
    expect(planFindReplace(texts, "slide", { matchCase: true })).toStrictEqual({
      total: 1,
      replaceCount: 1,
      hits: [{ index: 1, count: 1 }],
    });
    expect(planFindReplace(texts, "slide", { firstOnly: true })).toStrictEqual({
      total: 3,
      replaceCount: 1,
      hits: [
        { index: 1, count: 2 },
        { index: 2, count: 1 },
      ],
    });
    expect(planFindReplace(texts, "")).toStrictEqual({ total: 0, replaceCount: 0, hits: [] });
  });
});

describe("find_replace occurrence (UNI-927 X4fix F3)", () => {
  /** A text element whose second run holds two matches, so the 2nd and 3rd
   * matches of the element share a run and the 1st sits in another run. */
  const multi: OpenedPptxLike = {
    deck: {
      slides: [
        {
          elements: [
            { id: "t1", type: "text", text: { paragraphs: [{ runs: [{ text: "Go west" }, { text: "go GO" }] }] } },
          ],
        },
      ],
    },
  };
  const buildMulti = (occurrence: number) =>
    buildFindLinkOps(multi, 960, { op: "find_replace", find: "go", replace: "X", slideIndex: 0, elementId: "t1", occurrence });

  /** Same budget-of-one semantics as the vendored replaceAllInDeck (index.ts:3039-3062). */
  const applyFirstOnly = (runs: string[], op: Record<string, unknown>): string[] => {
    let budget = 1;
    // The terms here ("go" and the private-use markers) carry no regex metacharacters.
    const re = new RegExp(String(op.find), op.matchCase ? "g" : "gi");
    return runs.map((text) => text.replace(re, (match) => (budget-- > 0 ? String(op.replace) : match)));
  };

  it("replaces exactly the chosen match and restores the parked ones with their own case", () => {
    const run = (occurrence: number) => buildMulti(occurrence).reduce(applyFirstOnly, ["Go west", "go GO"]);
    expect(run(0)).toEqual(["X west", "go GO"]);
    expect(run(1)).toEqual(["Go west", "X GO"]);
    expect(run(2)).toEqual(["Go west", "go X"]);
  });

  it("emits only scoped firstOnly findReplace ops, the plain op for the first match", () => {
    expect(buildMulti(0)).toStrictEqual([{ op: "findReplace", find: "go", replace: "X", matchCase: false, firstOnly: true, slideIndex: 0, elementId: "t1" }]);
    const ops = buildMulti(2);
    expect(ops).toHaveLength(5);
    for (const op of ops) expect(op).toMatchObject({ op: "findReplace", firstOnly: true, slideIndex: 0, elementId: "t1" });
  });

  it("refuses an occurrence the element does not have, or one without its scope", () => {
    expect(errCode(() => buildMulti(3))).toBe("no_match");
    expect(errCode(() => buildMulti(-1))).toBe("bad_occurrence");
    expect(errCode(() => buildMulti(1.5))).toBe("bad_occurrence");
    expect(errCode(() => buildFindLinkOps(multi, 960, { op: "find_replace", find: "go", replace: "X", occurrence: 1 }))).toBe("bad_occurrence");
    expect(errCode(() => buildFindLinkOps(multi, 960, { op: "find_replace", find: "go", replace: "X", slideIndex: 0, elementId: "nope", occurrence: 1 }))).toBe("no_element");
    expect(errCode(() => buildFindLinkOps(multi, 960, { op: "find_replace", find: "\uF8FF", replace: "X", slideIndex: 0, elementId: "t1", occurrence: 0 }))).toBe("bad_find");
  });
});
