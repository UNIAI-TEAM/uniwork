// A3ui (UNI-927) - pure-function tests for the Insert panel model.
//
// No React and no DOM: the gallery data, the preview geometry, the extension
// rules, the default frames and the connector/group validation are all pure, so
// they are pinned here without a renderer.
import { describe, expect, it } from "vitest";
import {
  PPTX_CONNECTABLE_TYPES,
  PPTX_IMAGE_EXTS,
  PPTX_INSERT_FLAT_PRSTS,
  PPTX_INSERT_LINE_PRSTS,
  PPTX_INSERT_PICTURE_BOX,
  PPTX_INSERT_SHAPE_GROUPS,
  PPTX_INSERT_TEXT_BOX_KIND,
  PPTX_INSERT_WORDART_BOX,
  PPTX_INSERT_WORDART_PRESETS,
  defaultInsertBox,
  groupableSelection,
  imageExtFromName,
  shapePreviewBox,
  shapePreviewPath,
  validateConnectorRequest,
  wordArtParagraphs,
  wordArtStrokePt,
  wordArtStrokePx,
  type PptxInsertElementRef,
} from "./insert-model";

const allShapes = PPTX_INSERT_SHAPE_GROUPS.flatMap((group) => group.shapes);

describe("shape gallery data", () => {
  it("keeps the group order and a unique preset per cell", () => {
    expect(PPTX_INSERT_SHAPE_GROUPS.map((group) => group.id)).toEqual([
      "lines",
      "rects",
      "basic",
      "arrows",
      "stars",
      "flowchart",
      "callouts",
    ]);
    const prsts = allShapes.map((shape) => shape.prst);
    expect(new Set(prsts).size).toBe(prsts.length);
    expect(prsts).toContain("rect");
    expect(prsts).toContain("ellipse");
    expect(prsts).toContain("lineArrow");
  });

  it("labels every cell and group under office.pptx.insert", () => {
    for (const group of PPTX_INSERT_SHAPE_GROUPS) {
      expect(group.labelKey.startsWith("office.pptx.insert."), group.id).toBe(true);
      for (const shape of group.shapes) {
        expect(shape.labelKey.startsWith("office.pptx.insert."), shape.prst).toBe(true);
      }
    }
  });
});

describe("shapePreviewPath", () => {
  it("draws every gallery preset inside its own box", () => {
    for (const shape of allShapes) {
      const { w, h } = shapePreviewBox(shape.prst, 18);
      const d = shapePreviewPath(shape.prst, w, h);
      expect(d.length, shape.prst).toBeGreaterThan(0);
      expect(d.startsWith("M"), shape.prst).toBe(true);
    }
  });

  it("falls back to a rect for a preset it does not know", () => {
    expect(shapePreviewPath("notARealPreset", 20, 10)).toBe("M 0 0 L 20 0 L 20 10 L 0 10 Z");
  });

  it("adds one arrowhead per arrowed line and two for the double arrow", () => {
    const plain = shapePreviewPath("line", 20, 20);
    const single = shapePreviewPath("lineArrow", 20, 20);
    const double = shapePreviewPath("lineArrowDouble", 20, 20);
    expect(single.length).toBeGreaterThan(plain.length);
    expect(double.length).toBeGreaterThan(single.length);
  });

  it("flattens flowchart nodes but not plain shapes", () => {
    expect(shapePreviewBox("flowChartProcess", 18)).toEqual({ w: 18, h: 18 * 0.62 });
    expect(shapePreviewBox("rect", 18)).toEqual({ w: 18, h: 18 });
    for (const prst of PPTX_INSERT_FLAT_PRSTS) expect(shapePreviewPath(prst, 18, 11).length).toBeGreaterThan(0);
  });
});

describe("imageExtFromName", () => {
  it("accepts the extensions the engine takes and lowercases them", () => {
    for (const ext of PPTX_IMAGE_EXTS) {
      expect(imageExtFromName(`photo.${ext}`), ext).toBe(ext);
    }
    expect(imageExtFromName("PHOTO.PNG")).toBe("png");
    expect(imageExtFromName("my.photo.jpeg")).toBe("jpeg");
  });

  it("refuses a missing or unsupported extension", () => {
    expect(imageExtFromName("noext")).toBeNull();
    expect(imageExtFromName("trailing.")).toBeNull();
    expect(imageExtFromName("deck.pptx")).toBeNull();
  });
});

describe("defaultInsertBox", () => {
  it("gives a line a zero-height frame and a text box a wide one", () => {
    for (const prst of PPTX_INSERT_LINE_PRSTS) {
      expect(defaultInsertBox(prst).hPx, prst).toBe(0);
      expect(defaultInsertBox(prst).wPx, prst).toBeGreaterThan(0);
    }
    expect(defaultInsertBox(PPTX_INSERT_TEXT_BOX_KIND)).toEqual({ xPx: 100, yPx: 100, wPx: 360, hPx: 90 });
    expect(defaultInsertBox("rect")).toEqual({ xPx: 100, yPx: 80, wPx: 220, hPx: 150 });
  });

  it("keeps every default frame on the slide and non-negative", () => {
    for (const kind of [...PPTX_INSERT_LINE_PRSTS, PPTX_INSERT_TEXT_BOX_KIND, "rect", "ellipse"]) {
      const box = defaultInsertBox(kind);
      expect(box.xPx, kind).toBeGreaterThanOrEqual(0);
      expect(box.yPx, kind).toBeGreaterThanOrEqual(0);
      expect(box.wPx, kind).toBeGreaterThan(0);
      expect(box.hPx, kind).toBeGreaterThanOrEqual(0);
      expect(box.xPx + box.wPx, kind).toBeLessThanOrEqual(960);
    }
    expect(PPTX_INSERT_WORDART_BOX.wPx).toBeGreaterThan(0);
    expect(PPTX_INSERT_PICTURE_BOX.hPx).toBeGreaterThan(0);
  });
});

describe("wordArtParagraphs", () => {
  it("carries the preset colour, bold and italic into the run", () => {
    const bold = PPTX_INSERT_WORDART_PRESETS.find((preset) => preset.id === "blue")!;
    expect(wordArtParagraphs(bold, "Hello")).toEqual([{ runs: [{ text: "Hello", color: "#4472C4", bold: true }], align: "center" }]);
    const italic = PPTX_INSERT_WORDART_PRESETS.find((preset) => preset.id === "green-italic")!;
    const run = (wordArtParagraphs(italic, "Hi")[0] as { runs: Array<Record<string, unknown>> }).runs[0]!;
    expect(run.italic).toBe(true);
  });

  it("ships 12 presets with unique ids and one label each", () => {
    expect(PPTX_INSERT_WORDART_PRESETS).toHaveLength(12);
    expect(new Set(PPTX_INSERT_WORDART_PRESETS.map((preset) => preset.id)).size).toBe(12);
    for (const preset of PPTX_INSERT_WORDART_PRESETS) {
      expect(preset.nameKey.startsWith("office.pptx.insert.wordart.preset."), preset.id).toBe(true);
      expect(preset.fill).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("converts the EMU stroke width to pt and px", () => {
    expect(wordArtStrokePt(12700)).toBe(1);
    expect(wordArtStrokePt(19050)).toBe(1.5);
    expect(wordArtStrokePx(12700)).toBe(1.33);
    expect(wordArtStrokePx(19050)).toBe(2);
  });
});

describe("validateConnectorRequest", () => {
  const elements: PptxInsertElementRef[] = [
    { id: "t1", type: "text" },
    { id: "s1", type: "shape" },
    { id: "p1", type: "picture" },
    { id: "tbl1", type: "table" },
  ];
  const base = { slideIndex: 0, from: "s1", to: "p1", kind: "straight", arrow: "end" } as const;

  it("accepts a pair of connectable elements", () => {
    expect(validateConnectorRequest(base, elements)).toEqual({ ok: true });
  });

  it("refuses the same element twice", () => {
    expect(validateConnectorRequest({ ...base, to: "s1" }, elements)).toEqual({
      ok: false,
      reasonKey: "office.pptx.insert.connector.pick_both",
    });
  });

  it("refuses a missing or non-connectable endpoint", () => {
    expect(validateConnectorRequest({ ...base, to: "nope" }, elements).ok).toBe(false);
    expect(validateConnectorRequest({ ...base, to: "tbl1" }, elements).ok).toBe(false);
    expect(validateConnectorRequest({ ...base, from: "" }, elements).ok).toBe(false);
  });

  it("refuses an unknown kind or arrow value", () => {
    expect(validateConnectorRequest({ ...base, kind: "zigzag" as never }, elements).ok).toBe(false);
    expect(validateConnectorRequest({ ...base, arrow: "start" as never }, elements).ok).toBe(false);
  });

  it("pins the connectable type set to the vendored GROUPABLE set", () => {
    expect(PPTX_CONNECTABLE_TYPES).toEqual(["text", "shape", "picture"]);
  });
});

describe("groupableSelection", () => {
  const elements: PptxInsertElementRef[] = [
    { id: "t1", type: "text" },
    { id: "s1", type: "shape" },
    { id: "tbl1", type: "table" },
  ];

  it("keeps only the groupable ids, in selection order", () => {
    expect(groupableSelection(["tbl1", "s1", "t1"], elements)).toEqual(["s1", "t1"]);
  });

  it("returns an empty list when nothing groupable is selected", () => {
    expect(groupableSelection([], elements)).toEqual([]);
    expect(groupableSelection(["tbl1"], elements)).toEqual([]);
  });
});