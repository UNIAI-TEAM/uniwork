// A4e (UNI-927) - format + arrange edits (logic half).
//
// Binds the twelve vendored pptx-ops kinds this area owns to one typed,
// validated op builder. The wire round registers `FormatEdit` as `PptxEdit`
// kinds in model.ts and calls the builder mechanically:
//
//   this.txn(buildFormatOps(this.opened, this.fitWidthPx, edit))
//
// Vendored contract (READ ONLY - never imported; cited for every field):
//   setFill            packages/pptx-ops/src/ops/core-ops.ts:49
//   setStroke          packages/pptx-ops/src/ops/core-ops.ts:95
//   flipElements       packages/pptx-ops/src/ops/element-ops.ts:228
//   groupElements      packages/pptx-ops/src/ops/element-ops.ts:376
//   ungroupElement     packages/pptx-ops/src/ops/element-ops.ts:396
//   setShapeGeometry   packages/pptx-ops/src/ops/element-ops.ts:411
//   setShapeAdjust     packages/pptx-ops/src/ops/element-ops.ts:444
//   setTextAnchor      packages/pptx-ops/src/ops/element-ops.ts:487
//   setTextBodyProps   packages/pptx-ops/src/ops/element-ops.ts:504
//   setEffects         packages/pptx-ops/src/ops/element-ops.ts:532
//   alignElements      packages/pptx-ops/src/ops/arrange-ops.ts:110
//   distributeElements packages/pptx-ops/src/ops/arrange-ops.ts:135
//
// Exact field shapes (from the vendored sources):
//   GradientFillPatch  pptx-engine/src/generate.ts:1040-1050
//     stops: Array<{ pos: 0..1, color }>; angle?: number (1/60000 deg);
//     radial?: boolean; path?: 'circle'|'rect'|'shape';
//     fillTo?: { l, t, r, b } (fractions)
//   StrokePatch        pptx-engine/src/generate.ts:1198-1211
//     color: hex (required); widthEmu > 0 (required); dash?: string;
//     cap?: 'flat'|'rnd'|'sq'; compound?: 'sng'|'dbl'|'thickThin'|'thinThick'|'tri';
//     join?: 'round'|'bevel'|'miter';
//     gradient?: { stops, angle } (angle required, 1/60000 deg)
//   EffectsPatch       pptx-engine/src/index.ts:1303-1324
//     shadow?: { color, blurRad, dist, dirDeg, inner?, sx?, sy?, kxDeg?, kyDeg?, algn? } | null
//     glow?: { color, radius } | null
//     reflection?: { blurRad, startA, endPos, dist } | null
//     softEdge?: number | null (EMU radius); null clears, undefined leaves untouched
//   TextBodyPropsPatch pptx-engine/src/index.ts:1207-1215
//     vert?: 'horz'|'eaVert'|'vert'|'vert270'|'wordArtVert';
//     autofit?: 'none'|'shrink'|'resize'; insets?: Partial<{l,t,r,b}> (EMU); wrap?: boolean
//   alignElements      mode keys ALIGN_MODES arrange-ops.ts:32-39
//     'left'|'centerH'|'right'|'top'|'centerV'|'bottom'; to defaults to 'selection'
//   distributeElements axis 'horizontal'|'vertical'; to defaults to 'selection'
//
// Not bound here because they are already owned elsewhere: setTransform
// (model.ts edit_transform), setLink (edits/find-link-edits.ts set_link),
// reorderElement (model.ts reorder_element - the z-order gesture). Group-child
// targeting (`op.group`) is deliberately not exposed yet: every op targets a
// top-level element of the slide, so validation stays a plain element lookup.
//
// Geometry-free: none of the twelve ops carries an EMU rect - align/distribute
// read the existing element transforms inside the vendored engine, and the EMU
// values these ops do carry (stroke widthEmu, glow radius, softEdge, insets)
// are supplied by the caller, not derived from pixels. So there is no px->EMU
// conversion and no use of makePxToEmu; `fitWidthPx` stays in the signature
// only because every engine-half builder shares the same mechanical wire call.
import { PptxEngineError, type OpenedPptxLike, type PptxOp, type PptxSlideLike } from "../engine";

/** alignElements mode keys, verbatim from the vendored ALIGN_MODES
 * (arrange-ops.ts:32-39). */
export const PPTX_ALIGN_MODES = ["left", "centerH", "right", "top", "centerV", "bottom"] as const;
export type PptxAlignMode = (typeof PPTX_ALIGN_MODES)[number];

/** align/distribute container: 'selection' (default) or the whole slide. */
export const PPTX_ALIGN_TO = ["selection", "slide"] as const;
export type PptxAlignTo = (typeof PPTX_ALIGN_TO)[number];

export const PPTX_FLIP_AXES = ["h", "v"] as const;
export type PptxFlipAxis = (typeof PPTX_FLIP_AXES)[number];

export const PPTX_TEXT_ANCHORS = ["top", "middle", "bottom"] as const;
export type PptxTextAnchor = (typeof PPTX_TEXT_ANCHORS)[number];

export const PPTX_TEXT_VERT = ["horz", "eaVert", "vert", "vert270", "wordArtVert"] as const;
export type PptxTextVert = (typeof PPTX_TEXT_VERT)[number];

export const PPTX_TEXT_AUTOFIT = ["none", "shrink", "resize"] as const;
export type PptxTextAutofit = (typeof PPTX_TEXT_AUTOFIT)[number];

export const PPTX_STROKE_CAPS = ["flat", "rnd", "sq"] as const;
export type PptxStrokeCap = (typeof PPTX_STROKE_CAPS)[number];

export const PPTX_STROKE_COMPOUNDS = ["sng", "dbl", "thickThin", "thinThick", "tri"] as const;
export type PptxStrokeCompound = (typeof PPTX_STROKE_COMPOUNDS)[number];

export const PPTX_STROKE_JOINS = ["round", "bevel", "miter"] as const;
export type PptxStrokeJoin = (typeof PPTX_STROKE_JOINS)[number];

export const PPTX_GRADIENT_PATHS = ["circle", "rect", "shape"] as const;
export type PptxGradientPath = (typeof PPTX_GRADIENT_PATHS)[number];

/** One gradient stop (GradientFillPatch.stops, generate.ts:1041). */
export interface PptxGradientStop {
  /** 0..1 */
  pos: number;
  color: string;
}

/** GradientFillPatch (generate.ts:1040-1050), typed for the UI. */
export interface PptxGradientFillPatch {
  stops: PptxGradientStop[];
  /** 1/60000 degree (linear) */
  angle?: number;
  radial?: boolean;
  path?: PptxGradientPath;
  /** <a:fillToRect> focus insets as fractions */
  fillTo?: { l: number; t: number; r: number; b: number };
}

/** setFill payload: 'none' clears, a hex color is a solid fill, an object is a
 * gradient (core-ops.ts:49-62). */
export type PptxFillPatch = "none" | string | PptxGradientFillPatch;

/** StrokePatch (generate.ts:1198-1211): color + widthEmu are required; null on
 * the edit removes the outline (core-ops.ts:95-101). */
export interface PptxStrokePatch {
  color: string;
  /** > 0; 12700 EMU = 1pt */
  widthEmu: number;
  dash?: string;
  cap?: PptxStrokeCap;
  compound?: PptxStrokeCompound;
  join?: PptxStrokeJoin;
  gradient?: { stops: PptxGradientStop[]; angle: number };
}

/** EffectsPatch.shadow (index.ts:1306-1317). */
export interface PptxShadowPatch {
  color: string;
  blurRad: number;
  dist: number;
  dirDeg: number;
  inner?: boolean;
  sx?: number;
  sy?: number;
  kxDeg?: number;
  kyDeg?: number;
  algn?: string;
}

/** EffectsPatch (index.ts:1303-1324): null clears an effect, undefined leaves
 * it untouched. At least one of the four keys must be present. */
export interface PptxEffectsPatch {
  shadow?: PptxShadowPatch | null;
  glow?: { color: string; radius: number } | null;
  reflection?: { blurRad: number; startA: number; endPos: number; dist: number } | null;
  softEdge?: number | null;
}

/** TextBodyPropsPatch (index.ts:1207-1215). */
export interface PptxTextBodyPropsPatch {
  vert?: PptxTextVert;
  autofit?: PptxTextAutofit;
  insets?: Partial<{ l: number; t: number; r: number; b: number }>;
  wrap?: boolean;
}

/** The edit kinds this module builds (registered as PptxEdit kinds by the wire
 * round). Each maps 1:1 onto a vendored op of the same name in the citations
 * above; `elementIds` mirrors the vendored `els` field. */
export type FormatEdit =
  | { op: "set_fill"; slideIndex: number; elementId: string; fill: PptxFillPatch }
  | { op: "set_stroke"; slideIndex: number; elementId: string; stroke: PptxStrokePatch | null }
  | { op: "set_effects"; slideIndex: number; elementId: string; effects: PptxEffectsPatch }
  | { op: "set_shape_geometry"; slideIndex: number; elementId: string; prst: string }
  | { op: "set_shape_adjust"; slideIndex: number; elementId: string; adjust: Record<string, number> }
  | { op: "ungroup_element"; slideIndex: number; elementId: string }
  | { op: "group_elements"; slideIndex: number; elementIds: string[] }
  | { op: "flip_elements"; slideIndex: number; elementIds: string[]; axis: PptxFlipAxis }
  | { op: "set_text_anchor"; slideIndex: number; elementId: string; anchor: PptxTextAnchor }
  | { op: "set_text_body_props"; slideIndex: number; elementId: string; props: PptxTextBodyPropsPatch }
  | { op: "align_elements"; slideIndex: number; elementIds: string[]; mode: PptxAlignMode; to?: PptxAlignTo }
  | {
      op: "distribute_elements";
      slideIndex: number;
      elementIds: string[];
      axis: "horizontal" | "vertical";
      to?: PptxAlignTo;
    };

/** Hex colour guard, mirroring registry.ts:38-46 requireHexColor (#RRGGBB or
 * #RRGGBBAA, leading '#' optional). */
const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

const requireSlide = (opened: OpenedPptxLike, slideIndex: number, op: string): PptxSlideLike => {
  const slide =
    Number.isInteger(slideIndex) && slideIndex >= 0 ? opened.deck.slides[slideIndex] : undefined;
  if (!slide) {
    throw new PptxEngineError("fmt_no_slide", op + ": slide index " + String(slideIndex) + " does not exist");
  }
  return slide;
};

const requireElementId = (value: unknown, op: string, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new PptxEngineError("fmt_bad_element_id", op + ': "' + field + '" must be a non-empty element id');
  }
  return value;
};

const requireElement = (slide: PptxSlideLike, elementId: unknown, op: string, slideIndex: number): string => {
  const id = requireElementId(elementId, op, "elementId");
  if (!slide.elements.some((element) => element.id === id)) {
    throw new PptxEngineError("fmt_no_element", op + ': no element "' + id + '" on slide ' + String(slideIndex));
  }
  return id;
};

const requireNumber = (value: unknown, op: string, field: string, code: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PptxEngineError(code, op + ': "' + field + '" must be a finite number');
  }
  return value;
};

const requireBoolean = (value: unknown, op: string, field: string, code: string): boolean => {
  if (typeof value !== "boolean") {
    throw new PptxEngineError(code, op + ': "' + field + '" must be a boolean');
  }
  return value;
};

const requireHexColor = (value: unknown, op: string, field: string): string => {
  if (typeof value !== "string" || !HEX_COLOR_RE.test(value)) {
    throw new PptxEngineError(
      "fmt_bad_color",
      op + ': "' + field + '" must be a hex color "#RRGGBB" (or "#RRGGBBAA")',
    );
  }
  return value;
};

const requireEnum = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
  op: string,
  field: string,
  code: string,
): T[number] => {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new PptxEngineError(code, op + ': "' + field + '" must be one of ' + allowed.join(", "));
  }
  return value as T[number];
};

const normalizeStops = (raw: unknown, op: string, field: string): PptxGradientStop[] => {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new PptxEngineError("fmt_bad_gradient", op + ': "' + field + '" needs at least two { pos, color } entries');
  }
  return raw.map((entry, index) => {
    const stop = entry as { pos?: unknown; color?: unknown } | null;
    const pos = requireNumber(stop?.pos, op, field + "[" + index + "].pos", "fmt_bad_gradient");
    if (pos < 0 || pos > 1) {
      throw new PptxEngineError("fmt_bad_gradient", op + ': "' + field + "[" + index + '].pos" must be a fraction 0..1');
    }
    return { pos, color: requireHexColor(stop?.color, op, field + "[" + index + "].color") };
  });
};

const normalizeGradient = (value: unknown, op: string, field: string): PptxGradientFillPatch => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PptxEngineError("fmt_bad_gradient", op + ': "' + field + '" must be a gradient patch { stops: [{ pos, color }] }');
  }
  const input = value as Record<string, unknown>;
  const out: PptxGradientFillPatch = { stops: normalizeStops(input.stops, op, field + ".stops") };
  if (input.angle !== undefined) out.angle = requireNumber(input.angle, op, field + ".angle", "fmt_bad_gradient");
  if (input.radial !== undefined) out.radial = requireBoolean(input.radial, op, field + ".radial", "fmt_bad_gradient");
  if (input.path !== undefined) out.path = requireEnum(input.path, PPTX_GRADIENT_PATHS, op, field + ".path", "fmt_bad_gradient");
  if (input.fillTo !== undefined) {
    const focus = input.fillTo as Record<string, unknown> | null;
    if (typeof focus !== "object" || focus === null || Array.isArray(focus)) {
      throw new PptxEngineError("fmt_bad_gradient", op + ': "' + field + '.fillTo" must be { l, t, r, b } fractions');
    }
    out.fillTo = {
      l: requireNumber(focus.l, op, field + ".fillTo.l", "fmt_bad_gradient"),
      t: requireNumber(focus.t, op, field + ".fillTo.t", "fmt_bad_gradient"),
      r: requireNumber(focus.r, op, field + ".fillTo.r", "fmt_bad_gradient"),
      b: requireNumber(focus.b, op, field + ".fillTo.b", "fmt_bad_gradient"),
    };
  }
  return out;
};

const normalizeFill = (value: unknown, op: string): PptxFillPatch => {
  if (typeof value === "string") {
    return value === "none" ? "none" : requireHexColor(value, op, "fill");
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return normalizeGradient(value, op, "fill");
  }
  throw new PptxEngineError(
    "fmt_bad_fill",
    op + ': "fill" must be "none", a "#RRGGBB" color, or a gradient patch object',
  );
};

const normalizeStroke = (value: unknown, op: string): PptxStrokePatch | null => {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new PptxEngineError(
      "fmt_bad_stroke",
      op + ': "stroke" must be a stroke patch object, or null to remove the outline',
    );
  }
  const input = value as Record<string, unknown>;
  const color = requireHexColor(input.color, op, "stroke.color");
  const widthEmu = requireNumber(input.widthEmu, op, "stroke.widthEmu", "fmt_bad_stroke");
  if (widthEmu <= 0) {
    throw new PptxEngineError("fmt_bad_stroke", op + ': "stroke.widthEmu" must be > 0 (12700 EMU = 1pt)');
  }
  const out: PptxStrokePatch = { color, widthEmu };
  if (input.dash !== undefined) {
    if (typeof input.dash !== "string" || input.dash.length === 0) {
      throw new PptxEngineError("fmt_bad_stroke", op + ': "stroke.dash" must be a non-empty prstDash name');
    }
    out.dash = input.dash;
  }
  if (input.cap !== undefined) out.cap = requireEnum(input.cap, PPTX_STROKE_CAPS, op, "stroke.cap", "fmt_bad_stroke");
  if (input.compound !== undefined) {
    out.compound = requireEnum(input.compound, PPTX_STROKE_COMPOUNDS, op, "stroke.compound", "fmt_bad_stroke");
  }
  if (input.join !== undefined) out.join = requireEnum(input.join, PPTX_STROKE_JOINS, op, "stroke.join", "fmt_bad_stroke");
  if (input.gradient !== undefined) {
    const gradient = input.gradient as { stops?: unknown; angle?: unknown } | null;
    if (typeof gradient !== "object" || gradient === null || Array.isArray(gradient)) {
      throw new PptxEngineError("fmt_bad_stroke", op + ': "stroke.gradient" must be { stops, angle }');
    }
    out.gradient = {
      stops: normalizeStops(gradient.stops, op, "stroke.gradient.stops"),
      angle: requireNumber(gradient.angle, op, "stroke.gradient.angle", "fmt_bad_stroke"),
    };
  }
  return out;
};

const normalizeEffects = (value: unknown, op: string): PptxEffectsPatch => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PptxEngineError("fmt_bad_effects", op + ': "effects" must be an EffectsPatch object');
  }
  const input = value as Record<string, unknown>;
  const keys = ["shadow", "glow", "reflection", "softEdge"] as const;
  if (keys.every((key) => input[key] === undefined)) {
    throw new PptxEngineError(
      "fmt_bad_effects",
      op + ': "effects" needs at least one of shadow/glow/reflection/softEdge (null clears)',
    );
  }
  const out: PptxEffectsPatch = {};
  if (input.shadow !== undefined) {
    if (input.shadow === null) {
      out.shadow = null;
    } else {
      const raw = input.shadow as Record<string, unknown>;
      if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new PptxEngineError("fmt_bad_effects", op + ': "effects.shadow" must be an object or null');
      }
      const shadow: PptxShadowPatch = {
        color: requireHexColor(raw.color, op, "effects.shadow.color"),
        blurRad: requireNumber(raw.blurRad, op, "effects.shadow.blurRad", "fmt_bad_effects"),
        dist: requireNumber(raw.dist, op, "effects.shadow.dist", "fmt_bad_effects"),
        dirDeg: requireNumber(raw.dirDeg, op, "effects.shadow.dirDeg", "fmt_bad_effects"),
      };
      if (raw.inner !== undefined) shadow.inner = requireBoolean(raw.inner, op, "effects.shadow.inner", "fmt_bad_effects");
      for (const key of ["sx", "sy", "kxDeg", "kyDeg"] as const) {
        if (raw[key] !== undefined) shadow[key] = requireNumber(raw[key], op, "effects.shadow." + key, "fmt_bad_effects");
      }
      if (raw.algn !== undefined) {
        if (typeof raw.algn !== "string") {
          throw new PptxEngineError("fmt_bad_effects", op + ': "effects.shadow.algn" must be a string');
        }
        shadow.algn = raw.algn;
      }
      out.shadow = shadow;
    }
  }
  if (input.glow !== undefined) {
    if (input.glow === null) {
      out.glow = null;
    } else {
      const raw = input.glow as Record<string, unknown>;
      if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new PptxEngineError("fmt_bad_effects", op + ': "effects.glow" must be an object or null');
      }
      out.glow = {
        color: requireHexColor(raw.color, op, "effects.glow.color"),
        radius: requireNumber(raw.radius, op, "effects.glow.radius", "fmt_bad_effects"),
      };
    }
  }
  if (input.reflection !== undefined) {
    if (input.reflection === null) {
      out.reflection = null;
    } else {
      const raw = input.reflection as Record<string, unknown>;
      if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new PptxEngineError("fmt_bad_effects", op + ': "effects.reflection" must be an object or null');
      }
      out.reflection = {
        blurRad: requireNumber(raw.blurRad, op, "effects.reflection.blurRad", "fmt_bad_effects"),
        startA: requireNumber(raw.startA, op, "effects.reflection.startA", "fmt_bad_effects"),
        endPos: requireNumber(raw.endPos, op, "effects.reflection.endPos", "fmt_bad_effects"),
        dist: requireNumber(raw.dist, op, "effects.reflection.dist", "fmt_bad_effects"),
      };
    }
  }
  if (input.softEdge !== undefined) {
    out.softEdge =
      input.softEdge === null ? null : requireNumber(input.softEdge, op, "effects.softEdge", "fmt_bad_effects");
  }
  return out;
};

const normalizeTextBodyProps = (value: unknown, op: string): PptxTextBodyPropsPatch => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PptxEngineError("fmt_bad_text_body", op + ': "props" must be a TextBodyPropsPatch object');
  }
  const input = value as Record<string, unknown>;
  if (input.vert === undefined && input.autofit === undefined && input.insets === undefined && input.wrap === undefined) {
    throw new PptxEngineError("fmt_bad_text_body", op + ': "props" needs at least one of vert/autofit/insets/wrap');
  }
  const out: PptxTextBodyPropsPatch = {};
  if (input.vert !== undefined) out.vert = requireEnum(input.vert, PPTX_TEXT_VERT, op, "props.vert", "fmt_bad_text_body");
  if (input.autofit !== undefined) {
    out.autofit = requireEnum(input.autofit, PPTX_TEXT_AUTOFIT, op, "props.autofit", "fmt_bad_text_body");
  }
  if (input.wrap !== undefined) out.wrap = requireBoolean(input.wrap, op, "props.wrap", "fmt_bad_text_body");
  if (input.insets !== undefined) {
    const raw = input.insets as Record<string, unknown> | null;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new PptxEngineError("fmt_bad_text_body", op + ': "props.insets" must be { l?, t?, r?, b? } in EMU');
    }
    const insets: Partial<{ l: number; t: number; r: number; b: number }> = {};
    for (const side of ["l", "t", "r", "b"] as const) {
      if (raw[side] !== undefined) insets[side] = requireNumber(raw[side], op, "props.insets." + side, "fmt_bad_text_body");
    }
    out.insets = insets;
  }
  return out;
};

const requireElementIds = (
  slide: PptxSlideLike,
  value: unknown,
  op: string,
  slideIndex: number,
  min: number,
): string[] => {
  if (!Array.isArray(value) || value.length < min) {
    throw new PptxEngineError("fmt_bad_els", op + ': "elementIds" needs at least ' + min + " element id(s)");
  }
  const ids = value.map((raw) => requireElementId(raw, op, "elementIds[]"));
  if (new Set(ids).size !== ids.length) {
    throw new PptxEngineError("fmt_bad_els", op + ': "elementIds" lists the same element twice');
  }
  for (const id of ids) {
    if (!slide.elements.some((element) => element.id === id)) {
      throw new PptxEngineError("fmt_no_element", op + ': no element "' + id + '" on slide ' + String(slideIndex));
    }
  }
  return ids;
};

const requireTo = (value: unknown, op: string): PptxAlignTo | undefined => {
  if (value === undefined) return undefined;
  return requireEnum(value, PPTX_ALIGN_TO, op, "to", "fmt_bad_to");
};

/** One validated edit -> the vendored op the executor runs. Refusals are typed
 * PptxEngineError codes: fmt_no_slide, fmt_no_element, fmt_bad_element_id,
 * fmt_bad_fill, fmt_bad_color, fmt_bad_gradient, fmt_bad_stroke,
 * fmt_bad_effects, fmt_bad_prst, fmt_bad_adjust, fmt_bad_els, fmt_bad_axis,
 * fmt_bad_anchor, fmt_bad_text_body, fmt_bad_align, fmt_bad_to. */
export function buildFormatOps(opened: OpenedPptxLike, fitWidthPx: number, edit: FormatEdit): PptxOp[] {
  // No op in this area carries an EMU rect (see the module header), so nothing
  // converts. `void` keeps the uniform wire signature honest about the
  // deliberate non-use of the fit width.
  void fitWidthPx;
  switch (edit.op) {
    case "set_fill": {
      const slide = requireSlide(opened, edit.slideIndex, "set_fill");
      const elementId = requireElement(slide, edit.elementId, "set_fill", edit.slideIndex);
      const fill = normalizeFill(edit.fill, "set_fill");
      return [{ op: "setFill", target: { slide: edit.slideIndex, el: elementId }, fill }];
    }
    case "set_stroke": {
      const slide = requireSlide(opened, edit.slideIndex, "set_stroke");
      const elementId = requireElement(slide, edit.elementId, "set_stroke", edit.slideIndex);
      const stroke = normalizeStroke(edit.stroke, "set_stroke");
      return [{ op: "setStroke", target: { slide: edit.slideIndex, el: elementId }, stroke }];
    }
    case "set_effects": {
      const slide = requireSlide(opened, edit.slideIndex, "set_effects");
      const elementId = requireElement(slide, edit.elementId, "set_effects", edit.slideIndex);
      const effects = normalizeEffects(edit.effects, "set_effects");
      return [{ op: "setEffects", target: { slide: edit.slideIndex, el: elementId }, effects }];
    }
    case "set_shape_geometry": {
      const slide = requireSlide(opened, edit.slideIndex, "set_shape_geometry");
      const elementId = requireElement(slide, edit.elementId, "set_shape_geometry", edit.slideIndex);
      if (typeof edit.prst !== "string" || edit.prst.length === 0) {
        throw new PptxEngineError("fmt_bad_prst", 'set_shape_geometry "prst" must be a non-empty OOXML preset geometry name');
      }
      return [{ op: "setShapeGeometry", target: { slide: edit.slideIndex, el: elementId }, prst: edit.prst }];
    }
    case "set_shape_adjust": {
      const slide = requireSlide(opened, edit.slideIndex, "set_shape_adjust");
      const elementId = requireElement(slide, edit.elementId, "set_shape_adjust", edit.slideIndex);
      const adjust = edit.adjust;
      if (
        typeof adjust !== "object" ||
        adjust === null ||
        Array.isArray(adjust) ||
        Object.keys(adjust).length === 0
      ) {
        throw new PptxEngineError(
          "fmt_bad_adjust",
          'set_shape_adjust "adjust" must be a non-empty { gdName: number } map of avLst values',
        );
      }
      const out: Record<string, number> = {};
      for (const [name, raw] of Object.entries(adjust)) {
        out[name] = requireNumber(raw, "set_shape_adjust", "adjust." + name, "fmt_bad_adjust");
      }
      return [{ op: "setShapeAdjust", target: { slide: edit.slideIndex, el: elementId }, adjust: out }];
    }
    case "ungroup_element": {
      const slide = requireSlide(opened, edit.slideIndex, "ungroup_element");
      const elementId = requireElement(slide, edit.elementId, "ungroup_element", edit.slideIndex);
      const element = slide.elements.find((candidate) => candidate.id === elementId);
      if (element && element.type !== "group") {
        throw new PptxEngineError(
          "fmt_bad_group",
          'ungroup_element: element "' + elementId + '" is a ' + element.type + " element, not a group",
        );
      }
      return [{ op: "ungroupElement", target: { slide: edit.slideIndex, el: elementId } }];
    }
    case "group_elements": {
      const slide = requireSlide(opened, edit.slideIndex, "group_elements");
      const elementIds = requireElementIds(slide, edit.elementIds, "group_elements", edit.slideIndex, 2);
      return [{ op: "groupElements", target: { slide: edit.slideIndex }, els: elementIds }];
    }
    case "flip_elements": {
      const slide = requireSlide(opened, edit.slideIndex, "flip_elements");
      const elementIds = requireElementIds(slide, edit.elementIds, "flip_elements", edit.slideIndex, 1);
      const axis = requireEnum(edit.axis, PPTX_FLIP_AXES, "flip_elements", "axis", "fmt_bad_axis");
      return [{ op: "flipElements", target: { slide: edit.slideIndex }, els: elementIds, axis }];
    }
    case "set_text_anchor": {
      const slide = requireSlide(opened, edit.slideIndex, "set_text_anchor");
      const elementId = requireElement(slide, edit.elementId, "set_text_anchor", edit.slideIndex);
      const anchor = requireEnum(edit.anchor, PPTX_TEXT_ANCHORS, "set_text_anchor", "anchor", "fmt_bad_anchor");
      return [{ op: "setTextAnchor", target: { slide: edit.slideIndex, el: elementId }, anchor }];
    }
    case "set_text_body_props": {
      const slide = requireSlide(opened, edit.slideIndex, "set_text_body_props");
      const elementId = requireElement(slide, edit.elementId, "set_text_body_props", edit.slideIndex);
      const props = normalizeTextBodyProps(edit.props, "set_text_body_props");
      return [{ op: "setTextBodyProps", target: { slide: edit.slideIndex, el: elementId }, props }];
    }
    case "align_elements": {
      const slide = requireSlide(opened, edit.slideIndex, "align_elements");
      const to = requireTo(edit.to, "align_elements");
      const mode = requireEnum(edit.mode, PPTX_ALIGN_MODES, "align_elements", "mode", "fmt_bad_align");
      const elementIds = requireElementIds(slide, edit.elementIds, "align_elements", edit.slideIndex, to === "slide" ? 1 : 2);
      return [
        {
          op: "alignElements",
          target: { slide: edit.slideIndex },
          els: elementIds,
          mode,
          ...(to === undefined ? {} : { to }),
        },
      ];
    }
    case "distribute_elements": {
      const slide = requireSlide(opened, edit.slideIndex, "distribute_elements");
      const to = requireTo(edit.to, "distribute_elements");
      if (edit.axis !== "horizontal" && edit.axis !== "vertical") {
        throw new PptxEngineError(
          "fmt_bad_axis",
          'distribute_elements "axis" must be "horizontal" or "vertical"',
        );
      }
      const elementIds = requireElementIds(
        slide,
        edit.elementIds,
        "distribute_elements",
        edit.slideIndex,
        to === "slide" ? 1 : 3,
      );
      return [
        {
          op: "distributeElements",
          target: { slide: edit.slideIndex },
          els: elementIds,
          axis: edit.axis,
          ...(to === undefined ? {} : { to }),
        },
      ];
    }
  }
}