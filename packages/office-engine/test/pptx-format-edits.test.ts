// A4e (UNI-927) - format + arrange edit-builder tests.
//
// Vendored guard first: every op these builders can emit must exist in the
// vendored pptx-ops sources as `name: '<op>'`, and each exported enum list is
// pinned to the literal array the vendored validator reads. Op objects are
// compared strictly (absent optionals stay absent) and refusals branch on
// typed PptxEngineError codes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFormatOps,
  PPTX_ALIGN_MODES,
  PPTX_FILL_ELEMENT_TYPES,
  PPTX_FLIP_AXES,
  PPTX_GRADIENT_PATHS,
  PPTX_STROKE_CAPS,
  PPTX_STROKE_COMPOUNDS,
  PPTX_STROKE_ELEMENT_TYPES,
  PPTX_STROKE_JOINS,
  PPTX_TEXT_ANCHORS,
  PPTX_TEXT_AUTOFIT,
  PPTX_TEXT_VERT,
  PptxEngineError,
  type FormatEdit,
  type OpenedPptxLike,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

const ELEMENT_OPS = "pptx-ops/src/ops/element-ops.ts";
const ARRANGE_OPS = "pptx-ops/src/ops/arrange-ops.ts";
const CORE_OPS = "pptx-ops/src/ops/core-ops.ts";
const GENERATE = "pptx-engine/src/generate.ts";

/** Plain deck fixture: slide 0 has every element type the ops target
 * (text/shape/picture/group/table/chart); slide 1 is the second slide. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      {
        id: "s1",
        elements: [
          {
            id: "t1",
            type: "text",
            transform: { offset: { x: 0, y: 0, cx: 914400, cy: 457200 }, rot: 0 },
            text: { paragraphs: [{ runs: [{ text: "a" }] }] },
          },
          { id: "sh1", type: "shape", transform: { offset: { x: 100, y: 100, cx: 914400, cy: 914400 }, rot: 0 } },
          { id: "pic1", type: "picture", transform: { offset: { x: 200, y: 200, cx: 914400, cy: 685800 }, rot: 0 } },
          { id: "grp1", type: "group", transform: { offset: { x: 300, y: 300, cx: 914400, cy: 914400 }, rot: 0 } },
          { id: "tbl1", type: "table", transform: { offset: { x: 400, y: 400, cx: 1828800, cy: 914400 }, rot: 0 } },
          { id: "ch1", type: "chart", transform: { offset: { x: 500, y: 500, cx: 1828800, cy: 914400 }, rot: 0 } },
        ],
      },
      {
        id: "s2",
        elements: [
          { id: "t2", type: "text", transform: { offset: { x: 0, y: 0, cx: 914400, cy: 457200 }, rot: 0 } },
        ],
      },
    ],
  },
};

const build = (edit: FormatEdit) => buildFormatOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

/** Quoted literals on the vendored line that declares `field`. */
const literalsAfter = (source: string, pattern: RegExp): string[] => {
  const line = source.match(pattern)?.[0] ?? "";
  return Array.from(line.matchAll(/'([A-Za-z0-9]+)'/g), (match) => match[1] ?? "");
};

describe("format/arrange vendored guard", () => {
  it("emits only op names registered in the vendored pptx-ops sources", () => {
    const coreOps = readVendored(CORE_OPS);
    const elementOps = readVendored(ELEMENT_OPS);
    const arrangeOps = readVendored(ARRANGE_OPS);
    const registered = (source: string, op: string) => expect(source, op).toContain("name: '" + op + "'");
    // core-ops.ts:49 / :95
    registered(coreOps, "setFill");
    registered(coreOps, "setStroke");
    // element-ops.ts:228/:376/:396/:411/:444/:487/:504/:532
    for (const op of [
      "flipElements",
      "groupElements",
      "ungroupElement",
      "setShapeGeometry",
      "setShapeAdjust",
      "setTextAnchor",
      "setTextBodyProps",
      "setEffects",
    ]) {
      registered(elementOps, op);
    }
    // arrange-ops.ts:110 / :135
    registered(arrangeOps, "alignElements");
    registered(arrangeOps, "distributeElements");
  });

  it("pins PPTX_ALIGN_MODES to the vendored ALIGN_MODES keys", () => {
    const body = readVendored(ARRANGE_OPS).match(/ALIGN_MODES: Record<string, AlignKind> = \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const keys = Array.from(body.matchAll(/^\s*([A-Za-z]+):/gm), (match) => match[1] ?? "");
    expect(keys).toEqual([...PPTX_ALIGN_MODES]);
  });

  it("pins the flip axes and text anchor lists to the vendored validators", () => {
    const elementOps = readVendored(ELEMENT_OPS);
    expect(
      literalsAfter(elementOps, /if \(op\.axis !== 'h' && op\.axis !== 'v'\)[^\n]*/),
    ).toEqual([...PPTX_FLIP_AXES]);
    expect(
      literalsAfter(elementOps, /if \(!\[[^\]]*\]\.includes\(String\(op\.anchor\)\)\)[^\n]*/),
    ).toEqual([...PPTX_TEXT_ANCHORS]);
  });

  it("pins the text-body vert and autofit lists to the vendored validators", () => {
    const elementOps = readVendored(ELEMENT_OPS);
    expect(
      literalsAfter(elementOps, /if \(props\.vert && !?\[[^\]]*\]\.includes\(props\.vert\)\)[^\n]*/),
    ).toEqual([...PPTX_TEXT_VERT]);
    expect(
      literalsAfter(elementOps, /if \(props\.autofit && !?\[[^\]]*\]\.includes\(props\.autofit\)\)[^\n]*/),
    ).toEqual([...PPTX_TEXT_AUTOFIT]);
  });

  it("pins the element-type gates to the vendored resolveElement types opts", () => {
    const coreOps = readVendored(CORE_OPS);
    expect(
      literalsAfter(coreOps, /resolveElement\(ctx, op, \{ types: \['text', 'shape'\]/),
    ).toEqual([...PPTX_FILL_ELEMENT_TYPES]);
    expect(
      literalsAfter(coreOps, /resolveElement\(ctx, op, \{ types: \['text', 'shape', 'picture'\]/),
    ).toEqual([...PPTX_STROKE_ELEMENT_TYPES]);
  });

  it("pins the stroke cap/compound/join and gradient path lists to StrokePatch/GradientFillPatch", () => {
    const generate = readVendored(GENERATE);
    expect(literalsAfter(generate, /^\s*cap\?: [^\n]*/m)).toEqual([...PPTX_STROKE_CAPS]);
    expect(literalsAfter(generate, /^\s*compound\?: [^\n]*/m)).toEqual([...PPTX_STROKE_COMPOUNDS]);
    expect(literalsAfter(generate, /^\s*join\?: [^\n]*/m)).toEqual([...PPTX_STROKE_JOINS]);
    expect(literalsAfter(generate, /^\s*path\?: [^\n]*/m)).toEqual([...PPTX_GRADIENT_PATHS]);
  });
});

describe("fill/stroke op building", () => {
  it("builds the exact setFill op for a solid color and for none", () => {
    expect(build({ op: "set_fill", slideIndex: 1, elementId: "t2", fill: "#112233" })).toStrictEqual([
      { op: "setFill", target: { slide: 1, el: "t2" }, fill: "#112233" },
    ]);
    expect(build({ op: "set_fill", slideIndex: 0, elementId: "sh1", fill: "none" })[0]).toStrictEqual({
      op: "setFill",
      target: { slide: 0, el: "sh1" },
      fill: "none",
    });
  });

  it("builds the exact setFill op for a gradient patch, omitting absent optionals", () => {
    expect(
      build({
        op: "set_fill",
        slideIndex: 0,
        elementId: "sh1",
        fill: { stops: [{ pos: 0, color: "#FFFFFF" }, { pos: 1, color: "#000000" }], angle: 5400000 },
      }),
    ).toStrictEqual([
      {
        op: "setFill",
        target: { slide: 0, el: "sh1" },
        fill: { stops: [{ pos: 0, color: "#FFFFFF" }, { pos: 1, color: "#000000" }], angle: 5400000 },
      },
    ]);
    const [op] = build({
      op: "set_fill",
      slideIndex: 0,
      elementId: "sh1",
      fill: { stops: [{ pos: 0, color: "#FFFFFF" }, { pos: 1, color: "#000000" }] },
    });
    expect(op).toStrictEqual({
      op: "setFill",
      target: { slide: 0, el: "sh1" },
      fill: { stops: [{ pos: 0, color: "#FFFFFF" }, { pos: 1, color: "#000000" }] },
    });
  });

  it("builds the exact setStroke op, including a full patch and null removal", () => {
    expect(
      build({
        op: "set_stroke",
        slideIndex: 0,
        elementId: "pic1",
        stroke: { color: "#FF0000", widthEmu: 25400, dash: "dash", cap: "rnd", compound: "dbl", join: "round" },
      }),
    ).toStrictEqual([
      {
        op: "setStroke",
        target: { slide: 0, el: "pic1" },
        stroke: { color: "#FF0000", widthEmu: 25400, dash: "dash", cap: "rnd", compound: "dbl", join: "round" },
      },
    ]);
    expect(build({ op: "set_stroke", slideIndex: 0, elementId: "sh1", stroke: null })[0]).toStrictEqual({
      op: "setStroke",
      target: { slide: 0, el: "sh1" },
      stroke: null,
    });
  });

  it("keeps only the supplied stroke fields and a gradient line", () => {
    const [op] = build({ op: "set_stroke", slideIndex: 0, elementId: "sh1", stroke: { color: "#00FF00", widthEmu: 12700 } });
    expect(op).toStrictEqual({ op: "setStroke", target: { slide: 0, el: "sh1" }, stroke: { color: "#00FF00", widthEmu: 12700 } });
    const [grad] = build({
      op: "set_stroke",
      slideIndex: 0,
      elementId: "sh1",
      stroke: {
        color: "#000000",
        widthEmu: 12700,
        gradient: { stops: [{ pos: 0, color: "#FFFFFF" }, { pos: 1, color: "#000000" }], angle: 0 },
      },
    });
    expect(grad).toStrictEqual({
      op: "setStroke",
      target: { slide: 0, el: "sh1" },
      stroke: {
        color: "#000000",
        widthEmu: 12700,
        gradient: { stops: [{ pos: 0, color: "#FFFFFF" }, { pos: 1, color: "#000000" }], angle: 0 },
      },
    });
  });
});

describe("effects / geometry / adjust op building", () => {
  it("builds the exact setEffects op for a shadow, and for null clears", () => {
    expect(
      build({
        op: "set_effects",
        slideIndex: 0,
        elementId: "sh1",
        effects: { shadow: { color: "#000000", blurRad: 40000, dist: 20000, dirDeg: 2700000 } },
      }),
    ).toStrictEqual([
      {
        op: "setEffects",
        target: { slide: 0, el: "sh1" },
        effects: { shadow: { color: "#000000", blurRad: 40000, dist: 20000, dirDeg: 2700000 } },
      },
    ]);
    expect(
      build({ op: "set_effects", slideIndex: 0, elementId: "sh1", effects: { glow: null, softEdge: null } })[0],
    ).toStrictEqual({
      op: "setEffects",
      target: { slide: 0, el: "sh1" },
      effects: { glow: null, softEdge: null },
    });
  });

  it("builds glow, reflection and softEdge with their exact field sets", () => {
    const [op] = build({
      op: "set_effects",
      slideIndex: 0,
      elementId: "pic1",
      effects: {
        glow: { color: "#00FFFF", radius: 63500 },
        reflection: { blurRad: 1000, startA: 0.5, endPos: 0.4, dist: 0 },
        softEdge: 12700,
      },
    });
    expect(op).toStrictEqual({
      op: "setEffects",
      target: { slide: 0, el: "pic1" },
      effects: {
        glow: { color: "#00FFFF", radius: 63500 },
        reflection: { blurRad: 1000, startA: 0.5, endPos: 0.4, dist: 0 },
        softEdge: 12700,
      },
    });
  });

  it("builds the exact setShapeGeometry op (preset name passthrough)", () => {
    expect(build({ op: "set_shape_geometry", slideIndex: 0, elementId: "sh1", prst: "roundRect" })).toStrictEqual([
      { op: "setShapeGeometry", target: { slide: 0, el: "sh1" }, prst: "roundRect" },
    ]);
  });

  it("builds the exact setShapeAdjust op and copies only numeric entries", () => {
    expect(build({ op: "set_shape_adjust", slideIndex: 0, elementId: "sh1", adjust: { adj: 0.25, adj2: 3 } })).toStrictEqual([
      { op: "setShapeAdjust", target: { slide: 0, el: "sh1" }, adjust: { adj: 0.25, adj2: 3 } },
    ]);
  });

  it("builds the exact setTextAnchor and setTextBodyProps ops", () => {
    expect(build({ op: "set_text_anchor", slideIndex: 0, elementId: "t1", anchor: "middle" })).toStrictEqual([
      { op: "setTextAnchor", target: { slide: 0, el: "t1" }, anchor: "middle" },
    ]);
    expect(
      build({
        op: "set_text_body_props",
        slideIndex: 0,
        elementId: "t1",
        props: { vert: "vert270", autofit: "shrink", insets: { l: 91440 }, wrap: false },
      }),
    ).toStrictEqual([
      {
        op: "setTextBodyProps",
        target: { slide: 0, el: "t1" },
        props: { vert: "vert270", autofit: "shrink", insets: { l: 91440 }, wrap: false },
      },
    ]);
  });
});

describe("group / flip / arrange op building", () => {
  it("builds the exact groupElements op (els, no target.el)", () => {
    expect(build({ op: "group_elements", slideIndex: 0, elementIds: ["t1", "sh1"] })).toStrictEqual([
      { op: "groupElements", target: { slide: 0 }, els: ["t1", "sh1"] },
    ]);
  });

  it("builds the exact ungroupElement op", () => {
    expect(build({ op: "ungroup_element", slideIndex: 0, elementId: "grp1" })).toStrictEqual([
      { op: "ungroupElement", target: { slide: 0, el: "grp1" } },
    ]);
  });

  it("builds the exact flipElements op for both axes", () => {
    expect(build({ op: "flip_elements", slideIndex: 0, elementIds: ["sh1", "pic1"], axis: "h" })).toStrictEqual([
      { op: "flipElements", target: { slide: 0 }, els: ["sh1", "pic1"], axis: "h" },
    ]);
    expect(build({ op: "flip_elements", slideIndex: 0, elementIds: ["sh1"], axis: "v" })[0]).toStrictEqual({
      op: "flipElements",
      target: { slide: 0 },
      els: ["sh1"],
      axis: "v",
    });
  });

  it("builds the exact alignElements op, omitting 'to' when absent", () => {
    expect(build({ op: "align_elements", slideIndex: 0, elementIds: ["t1", "sh1"], mode: "centerH" })).toStrictEqual([
      { op: "alignElements", target: { slide: 0 }, els: ["t1", "sh1"], mode: "centerH" },
    ]);
    expect(
      build({ op: "align_elements", slideIndex: 0, elementIds: ["t1"], mode: "left", to: "slide" })[0],
    ).toStrictEqual({ op: "alignElements", target: { slide: 0 }, els: ["t1"], mode: "left", to: "slide" });
  });

  it("builds the exact distributeElements op for both axes and 'to'", () => {
    expect(
      build({ op: "distribute_elements", slideIndex: 0, elementIds: ["t1", "sh1", "pic1"], axis: "horizontal" }),
    ).toStrictEqual([
      { op: "distributeElements", target: { slide: 0 }, els: ["t1", "sh1", "pic1"], axis: "horizontal" },
    ]);
    expect(
      build({ op: "distribute_elements", slideIndex: 0, elementIds: ["t1", "sh1"], axis: "vertical", to: "slide" })[0],
    ).toStrictEqual({
      op: "distributeElements",
      target: { slide: 0 },
      els: ["t1", "sh1"],
      axis: "vertical",
      to: "slide",
    });
  });
});

describe("format/arrange refusals", () => {
  it("refuses a missing slide with fmt_no_slide", () => {
    expect(errCode(() => build({ op: "set_fill", slideIndex: 9, elementId: "t1", fill: "none" }))).toBe("fmt_no_slide");
    expect(errCode(() => build({ op: "flip_elements", slideIndex: -1, elementIds: ["t1"], axis: "h" }))).toBe("fmt_no_slide");
    expect(errCode(() => build({ op: "align_elements", slideIndex: 0.5, elementIds: ["t1"], mode: "left" }))).toBe("fmt_no_slide");
    expect(errCode(() => build({ op: "distribute_elements", slideIndex: 9, elementIds: ["t1", "sh1", "pic1"], axis: "horizontal" }))).toBe("fmt_no_slide");
  });

  it("refuses a missing element with fmt_no_element and a bad id with fmt_bad_element_id", () => {
    expect(errCode(() => build({ op: "set_fill", slideIndex: 0, elementId: "nope", fill: "none" }))).toBe("fmt_no_element");
    expect(errCode(() => build({ op: "set_effects", slideIndex: 0, elementId: "", effects: { softEdge: 1 } }))).toBe("fmt_bad_element_id");
    expect(errCode(() => build({ op: "set_text_anchor", slideIndex: 0, elementId: "nope", anchor: "top" }))).toBe("fmt_no_element");
    expect(errCode(() => build({ op: "ungroup_element", slideIndex: 0, elementId: "nope" }))).toBe("fmt_no_element");
    expect(
      errCode(() => build({ op: "group_elements", slideIndex: 0, elementIds: ["t1", "nope"] })),
    ).toBe("fmt_no_element");
  });

  it("refuses a non-group ungroup target with fmt_bad_group", () => {
    expect(errCode(() => build({ op: "ungroup_element", slideIndex: 0, elementId: "sh1" }))).toBe("fmt_bad_group");
  });

  it("refuses set_fill on a picture/table/chart/group with fmt_bad_element_type", () => {
    for (const elementId of ["pic1", "tbl1", "ch1", "grp1"]) {
      expect(errCode(() => build({ op: "set_fill", slideIndex: 0, elementId, fill: "none" }))).toBe(
        "fmt_bad_element_type",
      );
    }
    // text and shape stay allowed
    expect(build({ op: "set_fill", slideIndex: 0, elementId: "t1", fill: "none" })).toHaveLength(1);
  });

  it("refuses set_stroke on a table/chart/group with fmt_bad_element_type", () => {
    for (const elementId of ["tbl1", "ch1", "grp1"]) {
      expect(errCode(() => build({ op: "set_stroke", slideIndex: 0, elementId, stroke: null }))).toBe(
        "fmt_bad_element_type",
      );
    }
    // a picture border is strokable
    expect(build({ op: "set_stroke", slideIndex: 0, elementId: "pic1", stroke: null })).toHaveLength(1);
  });

  it("refuses set_effects / set_text_anchor / set_text_body_props outside their vendored types", () => {
    expect(
      errCode(() => build({ op: "set_effects", slideIndex: 0, elementId: "tbl1", effects: { softEdge: 1 } })),
    ).toBe("fmt_bad_element_type");
    expect(
      errCode(() => build({ op: "set_text_anchor", slideIndex: 0, elementId: "pic1", anchor: "top" })),
    ).toBe("fmt_bad_element_type");
    expect(
      errCode(() => build({ op: "set_text_body_props", slideIndex: 0, elementId: "pic1", props: { wrap: true } })),
    ).toBe("fmt_bad_element_type");
    // effects are valid on a picture; text anchor on a shape
    expect(build({ op: "set_effects", slideIndex: 0, elementId: "pic1", effects: { softEdge: 1 } })).toHaveLength(1);
    expect(build({ op: "set_text_anchor", slideIndex: 0, elementId: "sh1", anchor: "top" })).toHaveLength(1);
  });

  it("refuses group_elements with a non-groupable member with fmt_bad_element_type", () => {
    expect(
      errCode(() => build({ op: "group_elements", slideIndex: 0, elementIds: ["t1", "tbl1"] })),
    ).toBe("fmt_bad_element_type");
    expect(errCode(() => build({ op: "group_elements", slideIndex: 0, elementIds: ["t1", "pic1"] }))).toBe("");
  });

  it("refuses an out-of-union runtime op with fmt_bad_op", () => {
    expect(errCode(() => build({ op: "nope" } as unknown as FormatEdit))).toBe("fmt_bad_op");
  });

  it("refuses invalid fills with fmt_bad_fill, colors with fmt_bad_color, gradients with fmt_bad_gradient", () => {
    const fillEdit = (fill: unknown): FormatEdit => ({ op: "set_fill", slideIndex: 0, elementId: "sh1", fill }) as FormatEdit;
    expect(errCode(() => build(fillEdit(undefined)))).toBe("fmt_bad_fill");
    expect(errCode(() => build(fillEdit(7)))).toBe("fmt_bad_fill");
    expect(errCode(() => build(fillEdit("#12345")))).toBe("fmt_bad_color");
    expect(errCode(() => build(fillEdit("red")))).toBe("fmt_bad_color");
    expect(errCode(() => build(fillEdit({ stops: [{ pos: 0, color: "#fff" }] })))).toBe("fmt_bad_gradient");
    expect(errCode(() => build(fillEdit({ stops: [{ pos: 2, color: "#ffffff" }, { pos: 1, color: "#000000" }] })))).toBe("fmt_bad_gradient");
    expect(errCode(() => build(fillEdit({ stops: [{ pos: 0, color: "bad" }, { pos: 1, color: "#000000" }] })))).toBe("fmt_bad_color");
    expect(errCode(() => build(fillEdit({ stops: [{ pos: 0, color: "#ffffff" }, { pos: 1, color: "#000000" }], path: "ring" })))).toBe("fmt_bad_gradient");
  });

  it("refuses invalid strokes with fmt_bad_stroke", () => {
    const strokeEdit = (stroke: unknown): FormatEdit => ({ op: "set_stroke", slideIndex: 0, elementId: "sh1", stroke }) as FormatEdit;
    expect(errCode(() => build(strokeEdit(undefined)))).toBe("fmt_bad_stroke");
    expect(errCode(() => build(strokeEdit({ color: "#000000" })))).toBe("fmt_bad_stroke");
    expect(errCode(() => build(strokeEdit({ color: "#000000", widthEmu: 0 })))).toBe("fmt_bad_stroke");
    expect(errCode(() => build(strokeEdit({ color: "#000000", widthEmu: -1 })))).toBe("fmt_bad_stroke");
    expect(errCode(() => build(strokeEdit({ color: "x", widthEmu: 12700 })))).toBe("fmt_bad_color");
    expect(errCode(() => build(strokeEdit({ color: "#000000", widthEmu: 12700, cap: "round" })))).toBe("fmt_bad_stroke");
    expect(errCode(() => build(strokeEdit({ color: "#000000", widthEmu: 12700, compound: "triple" })))).toBe("fmt_bad_stroke");
    expect(errCode(() => build(strokeEdit({ color: "#000000", widthEmu: 12700, join: "sharp" })))).toBe("fmt_bad_stroke");
    expect(errCode(() => build(strokeEdit({ color: "#000000", widthEmu: 12700, gradient: { stops: [] } })))).toBe("fmt_bad_stroke");
  });

  it("refuses invalid effects with fmt_bad_effects", () => {
    const effectsEdit = (effects: unknown): FormatEdit => ({ op: "set_effects", slideIndex: 0, elementId: "sh1", effects }) as FormatEdit;
    expect(errCode(() => build(effectsEdit(undefined)))).toBe("fmt_bad_effects");
    expect(errCode(() => build(effectsEdit({})))).toBe("fmt_bad_effects");
    expect(errCode(() => build(effectsEdit({ shadow: { color: "#000000", blurRad: 1, dist: 1 } })))).toBe("fmt_bad_effects");
    expect(errCode(() => build(effectsEdit({ shadow: { color: "bad", blurRad: 1, dist: 1, dirDeg: 0 } })))).toBe("fmt_bad_color");
    expect(errCode(() => build(effectsEdit({ glow: { color: "#ffffff" } })))).toBe("fmt_bad_effects");
    expect(errCode(() => build(effectsEdit({ reflection: { blurRad: 1, startA: 0.5, endPos: 0.5 } })))).toBe("fmt_bad_effects");
    expect(errCode(() => build(effectsEdit({ softEdge: "big" })))).toBe("fmt_bad_effects");
  });

  it("refuses invalid geometry presets and adjustments", () => {
    expect(errCode(() => build({ op: "set_shape_geometry", slideIndex: 0, elementId: "sh1", prst: "" }))).toBe("fmt_bad_prst");
    expect(
      errCode(() => build({ op: "set_shape_geometry", slideIndex: 0, elementId: "sh1", prst: 7 as unknown as string })),
    ).toBe("fmt_bad_prst");
    expect(errCode(() => build({ op: "set_shape_adjust", slideIndex: 0, elementId: "sh1", adjust: {} }))).toBe("fmt_bad_adjust");
    expect(
      errCode(() => build({ op: "set_shape_adjust", slideIndex: 0, elementId: "sh1", adjust: { adj: Number.NaN } })),
    ).toBe("fmt_bad_adjust");
    expect(
      errCode(() => build({ op: "set_shape_adjust", slideIndex: 0, elementId: "sh1", adjust: { adj: "x" } as unknown as Record<string, number> })),
    ).toBe("fmt_bad_adjust");
  });

  it("refuses invalid element-id lists with fmt_bad_els", () => {
    expect(errCode(() => build({ op: "group_elements", slideIndex: 0, elementIds: ["t1"] }))).toBe("fmt_bad_els");
    expect(errCode(() => build({ op: "group_elements", slideIndex: 0, elementIds: ["t1", "t1"] }))).toBe("fmt_bad_els");
    expect(errCode(() => build({ op: "flip_elements", slideIndex: 0, elementIds: [], axis: "h" }))).toBe("fmt_bad_els");
    expect(
      errCode(() => build({ op: "align_elements", slideIndex: 0, elementIds: ["t1"], mode: "left" })),
    ).toBe("fmt_bad_els");
    expect(
      errCode(() => build({ op: "distribute_elements", slideIndex: 0, elementIds: ["t1", "sh1"], axis: "horizontal" })),
    ).toBe("fmt_bad_els");
    expect(errCode(() => build({ op: "flip_elements", slideIndex: 0, elementIds: ["t1", ""], axis: "h" }))).toBe("fmt_bad_element_id");
  });

  it("refuses invalid axes, anchors, aligns and 'to' values", () => {
    expect(
      errCode(() => build({ op: "flip_elements", slideIndex: 0, elementIds: ["t1"], axis: "z" as unknown as "h" })),
    ).toBe("fmt_bad_axis");
    expect(
      errCode(() => build({ op: "distribute_elements", slideIndex: 0, elementIds: ["t1", "sh1", "pic1"], axis: "diag" as unknown as "horizontal" })),
    ).toBe("fmt_bad_axis");
    expect(
      errCode(() => build({ op: "set_text_anchor", slideIndex: 0, elementId: "t1", anchor: "center" as unknown as "top" })),
    ).toBe("fmt_bad_anchor");
    expect(
      errCode(() => build({ op: "align_elements", slideIndex: 0, elementIds: ["t1", "sh1"], mode: "middle" as unknown as "left" })),
    ).toBe("fmt_bad_align");
    expect(
      errCode(() => build({ op: "align_elements", slideIndex: 0, elementIds: ["t1", "sh1"], mode: "left", to: "all" as unknown as "slide" })),
    ).toBe("fmt_bad_to");
  });

  it("refuses invalid text-body props with fmt_bad_text_body", () => {
    const propsEdit = (props: unknown): FormatEdit => ({ op: "set_text_body_props", slideIndex: 0, elementId: "t1", props }) as FormatEdit;
    expect(errCode(() => build(propsEdit({})))).toBe("fmt_bad_text_body");
    expect(errCode(() => build(propsEdit({ vert: "upsideDown" })))).toBe("fmt_bad_text_body");
    expect(errCode(() => build(propsEdit({ autofit: "grow" })))).toBe("fmt_bad_text_body");
    expect(errCode(() => build(propsEdit({ wrap: "yes" })))).toBe("fmt_bad_text_body");
    expect(errCode(() => build(propsEdit({ insets: { l: "x" } })))).toBe("fmt_bad_text_body");
  });

  it("throws a typed PptxEngineError, not a bare Error", () => {
    let caught: unknown;
    try {
      build({ op: "set_shape_geometry", slideIndex: 0, elementId: "sh1", prst: "" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PptxEngineError);
    expect((caught as { code?: string }).code).toBe("fmt_bad_prst");
  });
});