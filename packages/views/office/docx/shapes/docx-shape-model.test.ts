// B9 (UNI-924): the pure shape model — reads of the selected node's shape
// surface and the attrs patch every panel edit maps to (the exact fields
// pmDocToSavePlan reads back from a genXml node).
import { describe, expect, it } from "vitest";
import {
  DOCX_SHAPE_GALLERY,
  DOCX_SHAPE_WRAP_OPTIONS,
  docxShapeAttrsPatch,
  parseShapePx,
  readDocxShapeInfo,
} from "./docx-shape-model";

const attrsWith = (box: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  blockType: "passthrough",
  docxIndex: null,
  textboxes: [box],
  ...extra,
});

describe("readDocxShapeInfo", () => {
  it("reads the shape surface a docProtected node carries", () => {
    const info = readDocxShapeInfo(
      attrsWith(
        { fill: "4472C4", borderColor: "2F5496", widthPx: 189, heightPx: 113, prst: "rect" },
        { imageWrap: "square-left", imageOffsetXEmu: 914400, imageOffsetYEmu: 457200 },
      ),
    );
    expect(info).toEqual({
      prst: "rect",
      straight: false,
      fill: "4472C4",
      borderColor: "2F5496",
      widthPx: 189,
      heightPx: 113,
      wrap: "square-left",
      offsetXEmu: 914400,
      offsetYEmu: 457200,
    });
  });

  it("flags straight line/arrow boxes so the panel locks their height", () => {
    expect(readDocxShapeInfo(attrsWith({ prst: "line", widthPx: 189, heightPx: 12, paras: [] }))?.straight).toBe(true);
    expect(readDocxShapeInfo(attrsWith({ prst: "lineArrow", widthPx: 189, heightPx: 12, paras: [] }))?.straight).toBe(true);
    expect(readDocxShapeInfo(attrsWith({ prst: "rect", widthPx: 10, heightPx: 10 }))?.straight).toBe(false);
  });

  it("reads a text box (no prst) with null paint and no offset", () => {
    const info = readDocxShapeInfo(attrsWith({ widthPx: 189, heightPx: 113, paras: [{ runs: [{ text: "" }] }] }));
    expect(info).toEqual({
      prst: null,
      straight: false,
      fill: null,
      borderColor: null,
      widthPx: 189,
      heightPx: 113,
      wrap: null,
      offsetXEmu: null,
      offsetYEmu: null,
    });
  });

  it("reads no state from a node that is not a shape", () => {
    expect(readDocxShapeInfo(null)).toBeNull();
    expect(readDocxShapeInfo({})).toBeNull();
    expect(readDocxShapeInfo({ textboxes: [] })).toBeNull();
    expect(readDocxShapeInfo({ textboxes: "nope" })).toBeNull();
    expect(readDocxShapeInfo({ textboxes: [null] })).toBeNull();
  });

  it("drops an unknown wrap value instead of guessing", () => {
    expect(readDocxShapeInfo(attrsWith({ prst: "rect" }, { imageWrap: "sideways" }))?.wrap).toBeNull();
  });
});

describe("docxShapeAttrsPatch", () => {
  const base = attrsWith({ fill: "4472C4", borderColor: "2F5496", widthPx: 100, heightPx: 50, prst: "rect" });

  it("sets and clears the fill and the outline", () => {
    expect(docxShapeAttrsPatch(base, { kind: "fill", color: "C00000" })).toEqual({
      textboxes: [{ fill: "C00000", borderColor: "2F5496", widthPx: 100, heightPx: 50, prst: "rect" }],
    });
    expect(docxShapeAttrsPatch(base, { kind: "fill", color: null })).toEqual({
      textboxes: [{ borderColor: "2F5496", widthPx: 100, heightPx: 50, prst: "rect" }],
    });
    expect(docxShapeAttrsPatch(base, { kind: "outline", color: null })).toEqual({
      textboxes: [{ fill: "4472C4", widthPx: 100, heightPx: 50, prst: "rect" }],
    });
    expect(docxShapeAttrsPatch(base, { kind: "outline", color: "70AD47" })).toMatchObject({
      textboxes: [{ fill: "4472C4", borderColor: "70AD47" }],
    });
  });

  it("refuses a malformed colour and keeps the other boxes untouched", () => {
    expect(docxShapeAttrsPatch(base, { kind: "fill", color: "red" })).toBeNull();
    expect(docxShapeAttrsPatch(base, { kind: "outline", color: "#fff" })).toBeNull();
    const two = { textboxes: [base.textboxes![0], { fill: "FFFFFF", widthPx: 10, heightPx: 10 }] };
    expect(docxShapeAttrsPatch(two, { kind: "fill", color: null })).toMatchObject({
      textboxes: [{ borderColor: "2F5496" }, { fill: "FFFFFF" }],
    });
  });

  it("resizes inside the clamp and locks a straight line's height", () => {
    expect(docxShapeAttrsPatch(base, { kind: "size", widthPx: 200.4, heightPx: 0 })).toMatchObject({
      textboxes: [{ widthPx: 200, heightPx: 1 }],
    });
    const line = attrsWith({ borderColor: "000000", widthPx: 189, heightPx: 12, prst: "line", paras: [] });
    expect(docxShapeAttrsPatch(line, { kind: "size", widthPx: 300, heightPx: 400 })).toMatchObject({
      textboxes: [{ widthPx: 300, heightPx: 12 }],
    });
  });

  it("maps position edits to the anchor attrs applyImageWrap reads", () => {
    expect(
      docxShapeAttrsPatch(base, { kind: "position", wrap: "square-right", offsetXEmu: 914400.2, offsetYEmu: 0 }),
    ).toEqual({
      imageWrap: "square-right",
      imagePosH: null,
      imagePosV: null,
      imageOffsetXEmu: 914400,
      imageOffsetYEmu: 0,
    });
    expect(docxShapeAttrsPatch(base, { kind: "position", wrap: "front", offsetXEmu: null, offsetYEmu: null })).toEqual({
      imageWrap: "front",
      imagePosH: null,
      imagePosV: null,
      imageOffsetXEmu: null,
      imageOffsetYEmu: null,
    });
    expect(docxShapeAttrsPatch(base, { kind: "position", wrap: null, offsetXEmu: 5, offsetYEmu: 5 })).toEqual({
      imageWrap: null,
      imagePosH: null,
      imagePosV: null,
      imageOffsetXEmu: null,
      imageOffsetYEmu: null,
    });
  });

  it("refuses patches without a shape and unknown wraps", () => {
    expect(docxShapeAttrsPatch(null, { kind: "fill", color: null })).toBeNull();
    expect(docxShapeAttrsPatch({}, { kind: "fill", color: null })).toBeNull();
    expect(
      docxShapeAttrsPatch(base, { kind: "position", wrap: "sideways" as never, offsetXEmu: 0, offsetYEmu: 0 }),
    ).toBeNull();
  });
});

describe("gallery and numeric parsing", () => {
  it("ships the basic set in picker order", () => {
    expect(DOCX_SHAPE_GALLERY.map((item) => item.kind)).toEqual(["rect", "ellipse", "line", "arrow", "textBox"]);
    expect(DOCX_SHAPE_GALLERY.every((item) => item.labelKey.startsWith("office.docx.shapes."))).toBe(true);
  });

  it("offers inline first, then the floating layout modes", () => {
    expect(DOCX_SHAPE_WRAP_OPTIONS.map((option) => option.wrap)).toEqual([
      null,
      "square-left",
      "square-right",
      "topBottom",
      "behind",
      "front",
    ]);
  });

  it("parses whole px inside the clamp only", () => {
    expect(parseShapePx("189")).toBe(189);
    expect(parseShapePx(" 42 ")).toBe(42);
    expect(parseShapePx("0")).toBeNull();
    expect(parseShapePx("-3")).toBeNull();
    expect(parseShapePx("20000")).toBeNull();
    expect(parseShapePx("abc")).toBeNull();
  });
});
