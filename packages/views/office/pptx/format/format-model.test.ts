import { describe, expect, it } from "vitest";
import {
  PPTX_FORMAT_DASHES,
  arrangeEnabled,
  buildAlignEdit,
  buildAutofitEdit,
  buildDistributeEdit,
  buildEffectsEdit,
  buildFillEdit,
  buildFlipEdit,
  buildGroupEdit,
  buildShapeGeometryEdit,
  buildStrokeEdit,
  buildTextAnchorEdit,
  buildTextBodyPropsEdit,
  buildUngroupEdit,
  buildWrapEdit,
  emuToPoints,
  formatColorInputValue,
  formatFillAllowed,
  formatOpAllowed,
  formatRefusal,
  formatStrokeAllowed,
  gradientAngleUnits,
  isFormatColor,
  normalizeFormatHex,
  parseDegrees,
  parseNonNegative,
  parsePoints,
  pointsToEmu,
} from "./format-model";

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String((error as { code?: string }).code ?? error);
  }
  return "";
};

describe("format-model unit conversions", () => {
  it("round-trips points and EMU (12700 EMU = 1pt)", () => {
    expect(pointsToEmu(1)).toBe(12700);
    expect(pointsToEmu(0.5)).toBe(6350);
    expect(emuToPoints(25400)).toBe("2");
    expect(emuToPoints(19050)).toBe("1.5");
    expect(emuToPoints(Number.NaN)).toBe("0");
  });

  it("converts degrees to the 1/60000-degree gradient unit", () => {
    expect(gradientAngleUnits(90)).toBe(5400000);
    expect(gradientAngleUnits(0)).toBe(0);
    expect(gradientAngleUnits(45)).toBe(2700000);
  });

  it("parses fields and refuses what the engine would refuse", () => {
    expect(parsePoints("2.25")).toBe(2.25);
    expect(parsePoints("0")).toBeNull();
    expect(parsePoints("-1")).toBeNull();
    expect(parsePoints("abc")).toBeNull();
    expect(parseDegrees("-90")).toBe(270);
    expect(parseDegrees("450")).toBe(90);
    expect(parseDegrees("")).toBeNull();
    expect(parseNonNegative("0")).toBe(0);
    expect(parseNonNegative("-2")).toBeNull();
  });

  it("accepts the 6- and 8-digit hex forms and normalizes them", () => {
    expect(isFormatColor("#FFFFFF")).toBe(true);
    expect(isFormatColor("FFFFFF")).toBe(true);
    expect(isFormatColor("#FFFFFF80")).toBe(true);
    expect(isFormatColor("#FFF")).toBe(false);
    expect(normalizeFormatHex("#ffffff")).toBe("#FFFFFF");
    expect(normalizeFormatHex("#ff")).toBe("#ff");
    expect(formatColorInputValue("#FFFFFF80", "#000000")).toBe("#FFFFFF");
    expect(formatColorInputValue("nope", "#4472C4")).toBe("#4472C4");
  });
});

describe("element-type gates mirror the engine", () => {
  it("allows fill on text/shape and stroke/effects on text/shape/picture", () => {
    expect(formatFillAllowed("text")).toBe(true);
    expect(formatFillAllowed("shape")).toBe(true);
    expect(formatFillAllowed("picture")).toBe(false);
    expect(formatStrokeAllowed("picture")).toBe(true);
    expect(formatStrokeAllowed("group")).toBe(false);
  });

  it("maps each op to its own gate", () => {
    expect(formatOpAllowed("set_fill", "shape")).toBe(true);
    expect(formatOpAllowed("set_fill", "picture")).toBe(false);
    expect(formatOpAllowed("set_stroke", "picture")).toBe(true);
    expect(formatOpAllowed("ungroup_element", "group")).toBe(true);
    expect(formatOpAllowed("ungroup_element", "shape")).toBe(false);
    expect(formatOpAllowed("flip_elements", "table")).toBe(true);
  });

  it("gates arrange actions on the selection size", () => {
    expect(arrangeEnabled("group", 2)).toBe(true);
    expect(arrangeEnabled("group", 1)).toBe(false);
    expect(arrangeEnabled("ungroup", 1, "group")).toBe(true);
    expect(arrangeEnabled("ungroup", 1, "shape")).toBe(false);
    expect(arrangeEnabled("flip", 1)).toBe(true);
    expect(arrangeEnabled("align", 2)).toBe(true);
    expect(arrangeEnabled("align", 1)).toBe(false);
    expect(arrangeEnabled("distribute", 3)).toBe(true);
    expect(arrangeEnabled("distribute", 2)).toBe(false);
  });
});

describe("fill edits", () => {
  it("builds the solid, none and gradient set_fill payloads", () => {
    expect(buildFillEdit(0, "sh1", { kind: "solid", color: "#112233" })).toEqual({
      op: "set_fill",
      slideIndex: 0,
      elementId: "sh1",
      fill: "#112233",
    });
    expect(buildFillEdit(0, "sh1", { kind: "none" })).toEqual({
      op: "set_fill",
      slideIndex: 0,
      elementId: "sh1",
      fill: "none",
    });
    expect(
      buildFillEdit(1, "sh2", { kind: "gradient", from: "#ffffff", to: "#000000", angleDeg: 90, radial: true }),
    ).toEqual({
      op: "set_fill",
      slideIndex: 1,
      elementId: "sh2",
      fill: {
        stops: [
          { pos: 0, color: "#FFFFFF" },
          { pos: 1, color: "#000000" },
        ],
        angle: 5400000,
        radial: true,
      },
    });
  });

  it("omits the radial flag when false and refuses bad colours", () => {
    const edit = buildFillEdit(0, "sh1", { kind: "gradient", from: "#FFFFFF", to: "#000000", angleDeg: 0 });
    expect(edit.op === "set_fill" && typeof edit.fill === "object" && "radial" in edit.fill).toBe(false);
    expect(errCode(() => buildFillEdit(0, "sh1", { kind: "solid", color: "red" }))).toBe("fmt_bad_color");
    expect(errCode(() => buildFillEdit(0, "sh1", { kind: "gradient", from: "x", to: "#000000", angleDeg: 0 }))).toBe(
      "fmt_bad_color",
    );
    expect(
      errCode(() => buildFillEdit(0, "sh1", { kind: "gradient", from: "#FFFFFF", to: "#000000", angleDeg: Number.NaN })),
    ).toBe("fmt_bad_gradient");
  });
});

describe("stroke edits", () => {
  it("builds the set_stroke payload with the EMU width and omits a solid dash", () => {
    expect(buildStrokeEdit(0, "sh1", { kind: "solid", color: "#ff0000", widthPt: 2 })).toEqual({
      op: "set_stroke",
      slideIndex: 0,
      elementId: "sh1",
      stroke: { color: "#FF0000", widthEmu: 25400 },
    });
    expect(buildStrokeEdit(0, "sh1", { kind: "solid", color: "#000000", widthPt: 1, dash: "dash" })).toEqual({
      op: "set_stroke",
      slideIndex: 0,
      elementId: "sh1",
      stroke: { color: "#000000", widthEmu: 12700, dash: "dash" },
    });
  });

  it("emits the engine's null for no outline", () => {
    expect(buildStrokeEdit(0, "sh1", { kind: "none" })).toEqual({
      op: "set_stroke",
      slideIndex: 0,
      elementId: "sh1",
      stroke: null,
    });
  });

  it("refuses a bad colour and a non-positive width", () => {
    expect(errCode(() => buildStrokeEdit(0, "sh1", { kind: "solid", color: "x", widthPt: 1 }))).toBe("fmt_bad_color");
    expect(errCode(() => buildStrokeEdit(0, "sh1", { kind: "solid", color: "#000000", widthPt: 0 }))).toBe(
      "fmt_bad_stroke",
    );
    expect(errCode(() => buildStrokeEdit(0, "sh1", { kind: "solid", color: "#000000", widthPt: -1 }))).toBe(
      "fmt_bad_stroke",
    );
  });

  it("lists the dash presets the op accepts", () => {
    expect(PPTX_FORMAT_DASHES).toContain("dash");
    expect(PPTX_FORMAT_DASHES).toContain("solid");
  });
});

describe("effects edits", () => {
  it("builds shadow/glow/softEdge with EMU values and the 1/60000-degree direction", () => {
    expect(
      buildEffectsEdit(0, "sh1", {
        shadow: { color: "#000000", blurPt: 4, distPt: 2, dirDeg: 45 },
        glow: { color: "#00FFFF", radiusPt: 6 },
        softEdgePt: 0,
      }),
    ).toEqual({
      op: "set_effects",
      slideIndex: 0,
      elementId: "sh1",
      effects: {
        shadow: { color: "#000000", blurRad: 50800, dist: 25400, dirDeg: 2700000 },
        glow: { color: "#00FFFF", radius: 76200 },
        softEdge: 0,
      },
    });
  });

  it("carries inner when set and the null clears", () => {
    const [inner] = [buildEffectsEdit(0, "sh1", { shadow: { color: "#000000", blurPt: 1, distPt: 1, dirDeg: 0, inner: true } })];
    expect(inner.op === "set_effects" && inner.effects.shadow).toEqual({
      color: "#000000",
      blurRad: 12700,
      dist: 12700,
      dirDeg: 0,
      inner: true,
    });
    expect(buildEffectsEdit(0, "sh1", { glow: null, softEdgePt: null })).toEqual({
      op: "set_effects",
      slideIndex: 0,
      elementId: "sh1",
      effects: { glow: null, softEdge: null },
    });
  });

  it("refuses an empty request and bad colours", () => {
    expect(errCode(() => buildEffectsEdit(0, "sh1", {}))).toBe("fmt_bad_effects");
    expect(errCode(() => buildEffectsEdit(0, "sh1", { shadow: { color: "bad", blurPt: 1, distPt: 1, dirDeg: 0 } }))).toBe(
      "fmt_bad_color",
    );
    expect(errCode(() => buildEffectsEdit(0, "sh1", { glow: { color: "#FFFFFF", radiusPt: Number.NaN } }))).toBe(
      "fmt_bad_effects",
    );
  });
});

describe("geometry / adjust / text edits", () => {
  it("builds the set_shape_geometry payload", () => {
    expect(buildShapeGeometryEdit(0, "sh1", "roundRect")).toEqual({
      op: "set_shape_geometry",
      slideIndex: 0,
      elementId: "sh1",
      prst: "roundRect",
    });
  });

  it("refuses an empty preset", () => {
    expect(errCode(() => buildShapeGeometryEdit(0, "sh1", "  "))).toBe("fmt_bad_prst");
  });

  it("builds the anchor, autofit and wrap payloads", () => {
    expect(buildTextAnchorEdit(0, "t1", "middle")).toEqual({
      op: "set_text_anchor",
      slideIndex: 0,
      elementId: "t1",
      anchor: "middle",
    });
    expect(buildAutofitEdit(0, "t1", "shrink")).toEqual({
      op: "set_text_body_props",
      slideIndex: 0,
      elementId: "t1",
      props: { autofit: "shrink" },
    });
    expect(buildWrapEdit(0, "t1", false)).toEqual({
      op: "set_text_body_props",
      slideIndex: 0,
      elementId: "t1",
      props: { wrap: false },
    });
    expect(
      buildTextBodyPropsEdit(0, "t1", { vert: "vert270", insets: { l: 91440 } }),
    ).toEqual({
      op: "set_text_body_props",
      slideIndex: 0,
      elementId: "t1",
      props: { vert: "vert270", insets: { l: 91440 } },
    });
  });

  it("refuses an empty patch and unknown vert/autofit values", () => {
    expect(errCode(() => buildTextBodyPropsEdit(0, "t1", {}))).toBe("fmt_bad_text_body");
    expect(errCode(() => buildTextAnchorEdit(0, "t1", "center" as never))).toBe("fmt_bad_anchor");
    expect(errCode(() => buildTextBodyPropsEdit(0, "t1", { autofit: "grow" as never }))).toBe("fmt_bad_text_body");
  });
});

describe("arrange edits", () => {
  it("builds group, ungroup and flip payloads and de-duplicates ids", () => {
    expect(buildGroupEdit(0, ["t1", "sh1", "t1"])).toEqual({
      op: "group_elements",
      slideIndex: 0,
      elementIds: ["t1", "sh1"],
    });
    expect(buildUngroupEdit(0, "grp1")).toEqual({ op: "ungroup_element", slideIndex: 0, elementId: "grp1" });
    expect(buildFlipEdit(0, ["sh1"], "h")).toEqual({
      op: "flip_elements",
      slideIndex: 0,
      elementIds: ["sh1"],
      axis: "h",
    });
  });

  it("builds align and distribute payloads, omitting an absent 'to'", () => {
    expect(buildAlignEdit(0, ["t1", "sh1"], "centerH")).toEqual({
      op: "align_elements",
      slideIndex: 0,
      elementIds: ["t1", "sh1"],
      mode: "centerH",
    });
    expect(buildAlignEdit(0, ["t1"], "left", "slide")).toEqual({
      op: "align_elements",
      slideIndex: 0,
      elementIds: ["t1"],
      mode: "left",
      to: "slide",
    });
    expect(buildDistributeEdit(0, ["a", "b", "c"], "horizontal")).toEqual({
      op: "distribute_elements",
      slideIndex: 0,
      elementIds: ["a", "b", "c"],
      axis: "horizontal",
    });
  });

  it("refuses too few ids for the container the op targets", () => {
    expect(errCode(() => buildGroupEdit(0, ["t1"]))).toBe("fmt_bad_els");
    expect(errCode(() => buildFlipEdit(0, [], "h"))).toBe("fmt_bad_els");
    expect(errCode(() => buildAlignEdit(0, ["t1"], "left"))).toBe("fmt_bad_els");
    expect(errCode(() => buildDistributeEdit(0, ["a", "b"], "horizontal"))).toBe("fmt_bad_els");
    // one id is enough when the container is the whole slide
    expect(buildAlignEdit(0, ["t1"], "left", "slide")).toBeDefined();
    expect(buildDistributeEdit(0, ["a"], "vertical", "slide")).toBeDefined();
    expect(errCode(() => buildFlipEdit(0, ["t1"], "z" as never))).toBe("fmt_bad_axis");
  });
});

describe("formatRefusal", () => {
  it("throws a typed PptxEngineError carrying the engine's code", () => {
    const error = formatRefusal("fmt_bad_fill", "nope");
    expect(error.name).toBe("PptxEngineError");
    expect(error.code).toBe("fmt_bad_fill");
    expect(error.message).toBe("nope");
  });
});