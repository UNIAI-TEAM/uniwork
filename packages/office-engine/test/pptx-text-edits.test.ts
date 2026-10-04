// A1e (UNI-927) - text-formatting edit-builder tests (setFont + setParagraphFormat).
//
// Vendored guard first: every op these builders can emit must exist in the
// vendored pptx-ops text-ops.ts as `name: '<op>'`, and the exported kind/range
// literals must equal the vendored TextAlign union and the validate ranges. Op
// objects are compared strictly (absent optionals stay absent) and refusals
// branch on typed PptxEngineError codes. Both kinds are geometry-free, so the
// edit -> savePptx -> reopen round-trip is the wire round, not here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTextOps,
  PPTX_BULLET_KINDS,
  PPTX_FONT_SIZE_PT_MAX,
  PPTX_FONT_SIZE_PT_MIN,
  PPTX_PARAGRAPH_RANGES,
  PPTX_TEXT_ALIGNS,
  PptxEngineError,
  type OpenedPptxLike,
  type TextEdit,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

/** Plain deck fixture: two slides, a text + picture on slide 0, a shape on
 * slide 1 - enough for slide-exists and element-exists validation. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      {
        id: "s1",
        elements: [
          { id: "t1", type: "text", text: { paragraphs: [{ runs: [{ text: "hello" }] }] } },
          { id: "p1", type: "picture" },
        ],
      },
      {
        id: "s2",
        elements: [{ id: "t2", type: "shape", text: { paragraphs: [{ runs: [{ text: "world" }] }] } }],
      },
    ],
  },
};

const build = (edit: TextEdit) => buildTextOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

describe("text-formatting vendored guard", () => {
  it("emits only op names registered in the vendored text-ops source", () => {
    const textOps = readVendored("pptx-ops/src/ops/text-ops.ts");
    const emitted = [
      ...build({ op: "set_font", slideIndex: 0, elementId: "t1", font: { bold: true } }),
      ...build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { align: "center" } }),
    ];
    expect(emitted.map((op) => op.op).sort()).toStrictEqual(["setFont", "setParagraphFormat"]);
    for (const op of emitted) {
      expect(textOps).toContain("name: '" + op.op + "'");
    }
    // setText already exists as the PptxEdit kind edit_text - not rebound here.
    expect(textOps).toContain("name: 'setText'");
  });

  it("pins PPTX_TEXT_ALIGNS to the vendored TextAlign union", () => {
    const source = readVendored("pptx-engine/src/types.ts");
    const body = source.match(/export type TextAlign =([^\n]*)/)?.[1] ?? "";
    const union = Array.from(body.matchAll(/'([a-z]+)'/g), (match) => match[1]);
    expect(union).toEqual([...PPTX_TEXT_ALIGNS]);
  });

  it("pins PPTX_BULLET_KINDS to the vendored bullet union", () => {
    const source = readVendored("pptx-engine/src/index.ts");
    const body = source.match(/bullet\?:([^\n]*)/)?.[1] ?? "";
    const union = Array.from(body.matchAll(/'([a-z]+)'/g), (match) => match[1]);
    expect(union).toEqual([...PPTX_BULLET_KINDS]);
  });

  it("pins PPTX_PARAGRAPH_RANGES to the vendored setParagraphFormat ranges", () => {
    const source = readVendored("pptx-ops/src/ops/text-ops.ts");
    const block = source.match(/const ranges: Record<string, \[number, number\]> = \{([\s\S]*?)\n {4}\}/)?.[1] ?? "";
    for (const [field, [min, max]] of Object.entries(PPTX_PARAGRAPH_RANGES)) {
      expect(block).toContain(field + ": [" + min + ", " + max + "]");
    }
  });

  it("pins the font-size bounds to the vendored font-size module", () => {
    const source = readVendored("pptx-ops/src/font-size.ts");
    expect(source).toContain("FONT_SIZE_PT_MIN = " + PPTX_FONT_SIZE_PT_MIN);
    expect(source).toContain("FONT_SIZE_PT_MAX = " + PPTX_FONT_SIZE_PT_MAX);
  });
});

describe("set_font op building", () => {
  it("builds the exact setFont op for a family + size + colour edit", () => {
    expect(
      build({
        op: "set_font",
        slideIndex: 1,
        elementId: "t2",
        font: { fontFamily: "Arial", fontSizePt: 18, color: "#112233" },
      }),
    ).toStrictEqual([
      {
        op: "setFont",
        target: { slide: 1, el: "t2" },
        font: { fontFamily: "Arial", fontSizePt: 18, color: "#112233" },
      },
    ]);
  });

  it("keeps the boolean toggles and drops unknown fields", () => {
    const ops = build({
      op: "set_font",
      slideIndex: 0,
      elementId: "t1",
      font: { bold: true, italic: false, underline: true, strike: false, highlight: "yellow" } as never,
    });
    expect(ops[0]).toStrictEqual({
      op: "setFont",
      target: { slide: 0, el: "t1" },
      font: { bold: true, italic: false, underline: true, strike: false },
    });
  });

  it("accepts a #RRGGBBAA colour and a bare 6-digit hex", () => {
    expect(build({ op: "set_font", slideIndex: 0, elementId: "t1", font: { color: "#A1B2C3FF" } })[0]?.font).toStrictEqual({
      color: "#A1B2C3FF",
    });
    expect(build({ op: "set_font", slideIndex: 0, elementId: "t1", font: { color: "ff00aa" } })[0]?.font).toStrictEqual({
      color: "ff00aa",
    });
  });
});

describe("set_paragraph_format op building", () => {
  it("builds the exact setParagraphFormat op for an align + bullet + line-spacing edit", () => {
    expect(
      build({
        op: "set_paragraph_format",
        slideIndex: 0,
        elementId: "t1",
        format: { align: "justify", bullet: "char", bulletChar: "\u2022", lineSpacingPct: 150 },
      }),
    ).toStrictEqual([
      {
        op: "setParagraphFormat",
        target: { slide: 0, el: "t1" },
        format: { bullet: "char", align: "justify", bulletChar: "\u2022", lineSpacingPct: 150 },
      },
    ]);
  });

  it("carries numbering, spacing and level delta fields", () => {
    expect(
      build({
        op: "set_paragraph_format",
        slideIndex: 1,
        elementId: "t2",
        format: { bullet: "number", numType: "arabicPeriod", startAt: 3, spaceAfterPt: 6, indentDelta: -1 },
      })[0],
    ).toStrictEqual({
      op: "setParagraphFormat",
      target: { slide: 1, el: "t2" },
      format: { bullet: "number", numType: "arabicPeriod", startAt: 3, spaceAfterPt: 6, indentDelta: -1 },
    });
  });

  it("requires bulletImage when bullet is blip", () => {
    expect(
      build({
        op: "set_paragraph_format",
        slideIndex: 0,
        elementId: "t1",
        format: { bullet: "blip", bulletImage: { base64: "AAAA", ext: "png" } },
      })[0],
    ).toStrictEqual({
      op: "setParagraphFormat",
      target: { slide: 0, el: "t1" },
      format: { bullet: "blip", bulletImage: { base64: "AAAA", ext: "png" } },
    });
  });
});

describe("text-formatting refusals", () => {
  it("refuses a missing slide with text_no_slide", () => {
    expect(errCode(() => build({ op: "set_font", slideIndex: 9, elementId: "t1", font: { bold: true } }))).toBe(
      "text_no_slide",
    );
    expect(errCode(() => build({ op: "set_font", slideIndex: -1, elementId: "t1", font: { bold: true } }))).toBe(
      "text_no_slide",
    );
    expect(
      errCode(() => build({ op: "set_paragraph_format", slideIndex: 0.5, elementId: "t1", format: { align: "left" } })),
    ).toBe("text_no_slide");
  });

  it("refuses a missing element with text_no_element", () => {
    expect(errCode(() => build({ op: "set_font", slideIndex: 0, elementId: "nope", font: { bold: true } }))).toBe(
      "text_no_element",
    );
    expect(
      errCode(() => build({ op: "set_paragraph_format", slideIndex: 0, elementId: "", format: { align: "left" } })),
    ).toBe("text_no_element");
  });

  it("refuses a bad colour with text_bad_color", () => {
    const colorEdit = (color: unknown): TextEdit =>
      ({ op: "set_font", slideIndex: 0, elementId: "t1", font: { color } }) as TextEdit;
    for (const color of ["red", "#12345", "#GGGGGG", 123, null, undefined]) {
      if (color === undefined) continue;
      expect(errCode(() => build(colorEdit(color)))).toBe("text_bad_color");
    }
    expect(
      errCode(() =>
        build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { bulletColor: "nope" } }),
      ),
    ).toBe("text_bad_color");
  });

  it("refuses a bad font size with text_bad_font", () => {
    const sizeEdit = (fontSizePt: unknown): TextEdit =>
      ({ op: "set_font", slideIndex: 0, elementId: "t1", font: { fontSizePt } }) as TextEdit;
    for (const size of [0, 4001, Number.NaN, Number.POSITIVE_INFINITY, "12", undefined]) {
      if (size === undefined) continue;
      expect(errCode(() => build(sizeEdit(size)))).toBe("text_bad_font");
    }
  });

  it("refuses a non-object font or an empty font patch with text_bad_font", () => {
    expect(errCode(() => build({ op: "set_font", slideIndex: 0, elementId: "t1", font: null } as never))).toBe(
      "text_bad_font",
    );
    expect(errCode(() => build({ op: "set_font", slideIndex: 0, elementId: "t1", font: {} }))).toBe("text_bad_font");
    expect(
      errCode(() => build({ op: "set_font", slideIndex: 0, elementId: "t1", font: { bold: "yes" } } as never)),
    ).toBe("text_bad_font");
  });

  it("refuses a bad alignment with text_bad_paragraph", () => {
    const alignEdit = (align: unknown): TextEdit =>
      ({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { align } }) as TextEdit;
    for (const align of ["middle", "", 3, null]) {
      expect(errCode(() => build(alignEdit(align)))).toBe("text_bad_paragraph");
    }
  });

  it("refuses a bad bullet kind with text_bad_paragraph", () => {
    const bulletEdit = (bullet: unknown): TextEdit =>
      ({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { bullet } }) as TextEdit;
    for (const bullet of ["dot", "", 1, null]) {
      expect(errCode(() => build(bulletEdit(bullet)))).toBe("text_bad_paragraph");
    }
    // blip without its image source is refused too.
    expect(
      errCode(() => build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { bullet: "blip" } })),
    ).toBe("text_bad_paragraph");
  });

  it("refuses a bad level delta with text_bad_paragraph", () => {
    const deltaEdit = (indentDelta: unknown): TextEdit =>
      ({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { indentDelta } }) as TextEdit;
    for (const delta of [0, 2, -2, 1.5, "1"]) {
      expect(errCode(() => build(deltaEdit(delta)))).toBe("text_bad_paragraph");
    }
  });

  it("refuses a non-boolean rtl with text_bad_paragraph", () => {
    const rtlEdit = (rtl: unknown): TextEdit =>
      ({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { rtl } }) as TextEdit;
    for (const rtl of ["yes", 1, 0, null]) {
      expect(errCode(() => build(rtlEdit(rtl)))).toBe("text_bad_paragraph");
    }
  });

  it("refuses out-of-range paragraph numbers and a non-object format with text_bad_paragraph", () => {
    expect(
      errCode(() => build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { lineSpacingPct: 13201 } })),
    ).toBe("text_bad_paragraph");
    expect(
      errCode(() => build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { bulletSizePct: 24 } })),
    ).toBe("text_bad_paragraph");
    expect(
      errCode(() => build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: { startAt: 0 } })),
    ).toBe("text_bad_paragraph");
    expect(errCode(() => build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: null } as never))).toBe(
      "text_bad_paragraph",
    );
    expect(errCode(() => build({ op: "set_paragraph_format", slideIndex: 0, elementId: "t1", format: {} }))).toBe(
      "text_bad_paragraph",
    );
  });

  it("refuses an unknown op kind with bad_text_op", () => {
    expect(errCode(() => build({ op: "nope" } as unknown as TextEdit))).toBe("bad_text_op");
  });

  it("throws a typed PptxEngineError, not a bare Error", () => {
    let caught: unknown;
    try {
      build({ op: "set_font", slideIndex: 0, elementId: "t1", font: { color: "red" } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PptxEngineError);
    expect((caught as { code?: string }).code).toBe("text_bad_color");
  });
});
