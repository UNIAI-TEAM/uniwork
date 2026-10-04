import { describe, expect, it } from "vitest";
import {
  PPTX_TEXT_BULLET_OPTIONS,
  PPTX_TEXT_FONT_FAMILIES,
  PPTX_TEXT_FONT_SIZE_PT_PRESETS,
  PPTX_TEXT_FONT_TOGGLES,
  PPTX_TEXT_FORMAT_ELEMENT_TYPES,
  PPTX_TEXT_LINE_SPACING_PCT_PRESETS,
  buildAlignEdit,
  buildBulletEdit,
  buildFontFamilyEdit,
  buildFontSizeEdit,
  buildFontToggleEdit,
  buildLineSpacingEdit,
  buildTextColorEdit,
  isPptxHexColor,
  parsePptxFontSizePt,
  parsePptxLineSpacingPct,
  pptxColorInputValue,
  pptxTextFormatAllowed,
} from "./text-format-model";

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String((error as { code?: string }).code ?? error);
  }
  return "";
};

describe("text-format model vocabularies", () => {
  it("lists the four character toggles in render order", () => {
    expect([...PPTX_TEXT_FONT_TOGGLES]).toEqual(["bold", "italic", "underline", "strike"]);
  });

  it("offers the three bullet choices (no picture bullet)", () => {
    expect([...PPTX_TEXT_BULLET_OPTIONS]).toEqual(["none", "char", "number"]);
  });

  it("ships non-empty, unique font families and size/spacing presets", () => {
    expect(PPTX_TEXT_FONT_FAMILIES.length).toBeGreaterThan(0);
    expect(new Set(PPTX_TEXT_FONT_FAMILIES).size).toBe(PPTX_TEXT_FONT_FAMILIES.length);
    expect(PPTX_TEXT_FONT_SIZE_PT_PRESETS.length).toBeGreaterThan(0);
    expect(PPTX_TEXT_FONT_SIZE_PT_PRESETS.every((value) => Number.isInteger(value))).toBe(true);
    expect(PPTX_TEXT_LINE_SPACING_PCT_PRESETS.length).toBeGreaterThan(0);
    expect(PPTX_TEXT_LINE_SPACING_PCT_PRESETS).toContain(100);
  });
});

describe("element-type gate mirrors the vendored setElementFont/setElementParagraphFormat", () => {
  it("allows text and shape, refuses everything else", () => {
    expect([...PPTX_TEXT_FORMAT_ELEMENT_TYPES]).toEqual(["text", "shape"]);
    expect(pptxTextFormatAllowed("text")).toBe(true);
    expect(pptxTextFormatAllowed("shape")).toBe(true);
    expect(pptxTextFormatAllowed("picture")).toBe(false);
    expect(pptxTextFormatAllowed("group")).toBe(false);
    expect(pptxTextFormatAllowed("table")).toBe(false);
    expect(pptxTextFormatAllowed(null)).toBe(false);
    expect(pptxTextFormatAllowed(undefined)).toBe(false);
  });
});

describe("field parsing", () => {
  it("parses a font size inside 1..4000 pt and refuses anything else", () => {
    expect(parsePptxFontSizePt("18")).toBe(18);
    expect(parsePptxFontSizePt("12.5")).toBe(12.5);
    expect(parsePptxFontSizePt("1")).toBe(1);
    expect(parsePptxFontSizePt("4000")).toBe(4000);
    expect(parsePptxFontSizePt("0")).toBeNull();
    expect(parsePptxFontSizePt("4001")).toBeNull();
    expect(parsePptxFontSizePt("")).toBeNull();
    expect(parsePptxFontSizePt("abc")).toBeNull();
  });

  it("parses an integer line-spacing percent inside 0..13200 and refuses the rest", () => {
    expect(parsePptxLineSpacingPct("100")).toBe(100);
    expect(parsePptxLineSpacingPct("0")).toBe(0);
    expect(parsePptxLineSpacingPct("13200")).toBe(13200);
    expect(parsePptxLineSpacingPct("13201")).toBeNull();
    expect(parsePptxLineSpacingPct("-1")).toBeNull();
    expect(parsePptxLineSpacingPct("1.5")).toBeNull();
    expect(parsePptxLineSpacingPct("")).toBeNull();
  });

  it("accepts the 6- and 8-digit hex colour forms", () => {
    expect(isPptxHexColor("#FFFFFF")).toBe(true);
    expect(isPptxHexColor("FFFFFF")).toBe(true);
    expect(isPptxHexColor("#FFFFFF80")).toBe(true);
    expect(isPptxHexColor("#FFF")).toBe(false);
    expect(isPptxHexColor("red")).toBe(false);
    expect(pptxColorInputValue("#FFFFFF80", "#000000")).toBe("#FFFFFF");
    expect(pptxColorInputValue("nope", "#000000")).toBe("#000000");
  });
});

describe("font edits (set_font)", () => {
  it("emits one set_font per character toggle with that single flag", () => {
    expect(buildFontToggleEdit(1, "t1", "bold", true)).toEqual({
      op: "set_font",
      slideIndex: 1,
      elementId: "t1",
      font: { bold: true },
    });
    expect(buildFontToggleEdit(1, "t1", "italic", false)).toEqual({
      op: "set_font",
      slideIndex: 1,
      elementId: "t1",
      font: { italic: false },
    });
    expect(buildFontToggleEdit(1, "t1", "underline", true).op).toBe("set_font");
    expect(buildFontToggleEdit(1, "t1", "strike", true).op).toBe("set_font");
  });

  it("emits a set_font for the family, trimmed", () => {
    expect(buildFontFamilyEdit(0, "t1", "Arial")).toEqual({
      op: "set_font",
      slideIndex: 0,
      elementId: "t1",
      font: { fontFamily: "Arial" },
    });
    expect(buildFontFamilyEdit(0, "t1", "  Times New Roman  ")).toEqual({
      op: "set_font",
      slideIndex: 0,
      elementId: "t1",
      font: { fontFamily: "Times New Roman" },
    });
  });

  it("emits a set_font for the size and the colour (colour normalized)", () => {
    expect(buildFontSizeEdit(2, "sh1", 24)).toEqual({
      op: "set_font",
      slideIndex: 2,
      elementId: "sh1",
      font: { fontSizePt: 24 },
    });
    expect(buildTextColorEdit(0, "t1", "#a1b2c3")).toEqual({
      op: "set_font",
      slideIndex: 0,
      elementId: "t1",
      font: { color: "#A1B2C3" },
    });
  });

  it("refuses a bad size with text_bad_font", () => {
    expect(errCode(() => buildFontSizeEdit(0, "t1", 0))).toBe("text_bad_font");
    expect(errCode(() => buildFontSizeEdit(0, "t1", 4001))).toBe("text_bad_font");
    expect(errCode(() => buildFontSizeEdit(0, "t1", Number.NaN))).toBe("text_bad_font");
    expect(errCode(() => buildFontSizeEdit(0, "t1", Number.POSITIVE_INFINITY))).toBe("text_bad_font");
  });

  it("refuses an empty family and a bad colour with the engine's codes", () => {
    expect(errCode(() => buildFontFamilyEdit(0, "t1", "   "))).toBe("text_bad_font");
    expect(errCode(() => buildTextColorEdit(0, "t1", "red"))).toBe("text_bad_color");
    expect(errCode(() => buildTextColorEdit(0, "t1", "#12345"))).toBe("text_bad_color");
  });
});

describe("paragraph edits (set_paragraph_format)", () => {
  it("emits one set_paragraph_format per alignment", () => {
    expect(buildAlignEdit(3, "t2", "center")).toEqual({
      op: "set_paragraph_format",
      slideIndex: 3,
      elementId: "t2",
      format: { align: "center" },
    });
    const justify = buildAlignEdit(3, "t2", "justify");
    expect(justify.op === "set_paragraph_format" && justify.format).toEqual({ align: "justify" });
  });

  it("emits one set_paragraph_format per bullet choice", () => {
    expect(buildBulletEdit(0, "t1", "char")).toEqual({
      op: "set_paragraph_format",
      slideIndex: 0,
      elementId: "t1",
      format: { bullet: "char" },
    });
    const numbered = buildBulletEdit(0, "t1", "number");
    expect(numbered.op === "set_paragraph_format" && numbered.format).toEqual({ bullet: "number" });
    const none = buildBulletEdit(0, "t1", "none");
    expect(none.op === "set_paragraph_format" && none.format).toEqual({ bullet: "none" });
  });

  it("emits one set_paragraph_format for line spacing", () => {
    expect(buildLineSpacingEdit(0, "t1", 150)).toEqual({
      op: "set_paragraph_format",
      slideIndex: 0,
      elementId: "t1",
      format: { lineSpacingPct: 150 },
    });
  });

  it("refuses a bad alignment, bullet and spacing with text_bad_paragraph", () => {
    expect(errCode(() => buildAlignEdit(0, "t1", "middle" as never))).toBe("text_bad_paragraph");
    expect(errCode(() => buildBulletEdit(0, "t1", "dot" as never))).toBe("text_bad_paragraph");
    expect(errCode(() => buildBulletEdit(0, "t1", "blip" as never))).toBe("text_bad_paragraph");
    expect(errCode(() => buildLineSpacingEdit(0, "t1", 13201))).toBe("text_bad_paragraph");
    expect(errCode(() => buildLineSpacingEdit(0, "t1", -1))).toBe("text_bad_paragraph");
    expect(errCode(() => buildLineSpacingEdit(0, "t1", Number.NaN))).toBe("text_bad_paragraph");
  });

  it("never emits a field the panel does not surface (no invented highlight, no raw op)", () => {
    const font = buildFontToggleEdit(0, "t1", "bold", true);
    expect(Object.keys(font)).toEqual(["op", "slideIndex", "elementId", "font"]);
    expect(font.op === "set_font" && Object.keys(font.font)).toEqual(["bold"]);
    const format = buildAlignEdit(0, "t1", "left");
    expect(format.op === "set_paragraph_format" && Object.keys(format.format)).toEqual(["align"]);
  });
});
