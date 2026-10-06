// B7e (UNI-927) - header/footer + insert-slide-from-another-pptx builder tests.
//
// Vendored guard first: every op these builders can emit must exist in
// slide-ops.ts as `name: '<op>'`, and the vendored applyHeaderFooter settings
// shape (headerfooter.ts HeaderFooterOptions) is parsed and pinned. Op objects
// are compared strictly (absent optionals stay absent) and refusals branch on
// typed PptxEngineError codes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHeaderFooterOps,
  PptxEngineError,
  type HeaderFooterEdit,
  type OpenedPptxLike,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

/** Plain deck fixture: two slides - enough for the at/replace range checks. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      { id: "s1", elements: [] },
      { id: "s2", elements: [] },
    ],
  },
};

/** A minimal extracted single-slide source (extra key rides through). */
const source = {
  srcSlidePath: "ppt/slides/slide1.xml",
  slideXml: "<p:sld/>",
  rels: [{ id: "rId1", type: ".../slideLayout", target: "../slideLayouts/slideLayout1.xml" }],
  media: [{ path: "ppt/media/image1.png", bytes: new Uint8Array([1, 2, 3]) }],
  layoutChain: [{ path: "ppt/slideLayouts/slideLayout1.xml", bytes: new Uint8Array([4]) }],
};

const build = (edit: HeaderFooterEdit) => buildHeaderFooterOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

describe("header/footer vendored guard", () => {
  it("emits only op names registered in the vendored slide-ops source", () => {
    const slideOps = readVendored("pptx-ops/src/ops/slide-ops.ts");
    // The exact registry entries B7e binds to (slide-ops.ts:228 and :605).
    for (const op of ["insertSlidePptx", "applyHeaderFooter"]) {
      expect(slideOps).toContain("name: '" + op + "'");
    }
  });

  it("pins the settings shape to the vendored HeaderFooterOptions fields", () => {
    const source = readVendored("pptx-engine/src/headerfooter.ts");
    const body = source.match(/export interface HeaderFooterOptions \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const fields = Array.from(body.matchAll(/^\s{2}([a-zA-Z]+)\??:/gm), (m) => m[1]);
    expect(fields).toEqual(["footer", "slideNum", "date", "dateAuto"]);
  });

  it("pins the insert source fields to the vendored MergeSlideSource", () => {
    const source = readVendored("pptx-engine/src/index.ts");
    const body = source.match(/export interface MergeSlideSource \{([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const field of ["slideXml", "rels", "media", "layoutChain"]) {
      expect(body).toContain(field + ":");
    }
  });
});

describe("apply_header_footer op building", () => {
  it("builds the exact deck-level applyHeaderFooter op (no target)", () => {
    expect(build({ op: "apply_header_footer", settings: { footer: "Confidential", slideNum: true } }))
      .toStrictEqual([
        { op: "applyHeaderFooter", settings: { footer: "Confidential", slideNum: true } },
      ]);
  });

  it("accepts every vendored settings field, including date + dateAuto", () => {
    const settings = { footer: "F", slideNum: false, date: "2026-10-04", dateAuto: true };
    expect(build({ op: "apply_header_footer", settings })).toStrictEqual([
      { op: "applyHeaderFooter", settings },
    ]);
  });

  it("accepts an empty settings object (clear all header/footer placeholders)", () => {
    expect(build({ op: "apply_header_footer", settings: {} })).toStrictEqual([
      { op: "applyHeaderFooter", settings: {} },
    ]);
  });

  it("passes settings through by reference, untouched", () => {
    const settings = { footer: "keep", extra: "ignored" } as never;
    const built = build({ op: "apply_header_footer", settings });
    expect(built[0]?.settings).toBe(settings);
  });
});

describe("insert_slide_pptx op building", () => {
  it("builds the exact insertSlidePptx op with at + replace", () => {
    expect(build({ op: "insert_slide_pptx", source, at: 1, replace: true })).toStrictEqual([
      { op: "insertSlidePptx", source, at: 1, replace: true },
    ]);
  });

  it("builds the exact insertSlidePptx op without at/replace (append at the end)", () => {
    expect(build({ op: "insert_slide_pptx", source })).toStrictEqual([
      { op: "insertSlidePptx", source },
    ]);
  });

  it("accepts the append slot at === slideCount (0..slideCount is in range)", () => {
    expect(build({ op: "insert_slide_pptx", source, at: 2 })).toStrictEqual([
      { op: "insertSlidePptx", source, at: 2 },
    ]);
  });

  it("accepts empty source arrays (may be empty per the vendored validate)", () => {
    const empty = { slideXml: "<p:sld/>", rels: [], media: [], layoutChain: [] };
    expect(build({ op: "insert_slide_pptx", source: empty, at: 0 })).toStrictEqual([
      { op: "insertSlidePptx", source: empty, at: 0 },
    ]);
  });

  it("passes the source arrays through untouched (identity, not a copy)", () => {
    const built = build({ op: "insert_slide_pptx", source });
    expect(built[0]?.source).toBe(source);
  });
});

describe("header/footer + insert refusals", () => {
  it("refuses non-object settings with bad_hf_settings", () => {
    const bad = (settings: unknown): HeaderFooterEdit =>
      ({ op: "apply_header_footer", settings }) as HeaderFooterEdit;
    for (const settings of [null, undefined, "footer", 7, true, ["x"]]) {
      expect(errCode(() => build(bad(settings)))).toBe("bad_hf_settings");
    }
  });

  it("refuses wrong settings field types with bad_hf_settings", () => {
    const bad = (settings: unknown): HeaderFooterEdit =>
      ({ op: "apply_header_footer", settings }) as HeaderFooterEdit;
    for (const settings of [
      { footer: 7 },
      { date: 7 },
      { slideNum: "yes" },
      { dateAuto: 1 },
    ]) {
      expect(errCode(() => build(bad(settings)))).toBe("bad_hf_settings");
    }
  });

  it("refuses a non-string slideXml with bad_insert_source", () => {
    const bad = (src: unknown): HeaderFooterEdit =>
      ({ op: "insert_slide_pptx", source: src }) as HeaderFooterEdit;
    for (const src of [
      null,
      undefined,
      "xml",
      7,
      { slideXml: 7, rels: [], media: [], layoutChain: [] },
      { slideXml: undefined, rels: [], media: [], layoutChain: [] },
      { rels: [], media: [], layoutChain: [] },
    ]) {
      expect(errCode(() => build(bad(src)))).toBe("bad_insert_source");
    }
  });

  it("refuses non-array rels/media/layoutChain with bad_insert_source", () => {
    const bad = (src: unknown): HeaderFooterEdit =>
      ({ op: "insert_slide_pptx", source: src }) as HeaderFooterEdit;
    for (const field of ["rels", "media", "layoutChain"] as const) {
      expect(errCode(() => build(bad({ slideXml: "<p:sld/>", [field]: "no" })))).toBe(
        "bad_insert_source",
      );
      expect(errCode(() => build(bad({ slideXml: "<p:sld/>", [field]: undefined })))).toBe(
        "bad_insert_source",
      );
    }
  });

  it("refuses an out-of-range at with bad_insert_at", () => {
    const bad = (at: unknown): HeaderFooterEdit =>
      ({ op: "insert_slide_pptx", source, at }) as HeaderFooterEdit;
    for (const at of [-1, 3, 1.5, Number.NaN, "1", true, null]) {
      expect(errCode(() => build(bad(at)))).toBe("bad_insert_at");
    }
  });

  it("refuses replace without a valid existing-slide at with bad_insert_replace", () => {
    expect(errCode(() => build({ op: "insert_slide_pptx", source, replace: true }))).toBe(
      "bad_insert_replace",
    );
    // at === slideCount is the append slot, not an existing slide.
    expect(errCode(() => build({ op: "insert_slide_pptx", source, at: 2, replace: true }))).toBe(
      "bad_insert_replace",
    );
  });

  it("throws a typed PptxEngineError, not a bare Error", () => {
    let caught: unknown;
    try {
      build({ op: "insert_slide_pptx", source, at: 9 } as unknown as HeaderFooterEdit);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PptxEngineError);
    expect((caught as { code?: string }).code).toBe("bad_insert_at");
  });
});