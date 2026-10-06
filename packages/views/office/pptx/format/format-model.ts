/**
 * Format panel model (A4ui, UNI-927) - the pure half of the Format tab.
 *
 * Everything here is data or a pure function, so the six sections of the panel
 * stay presentational and the contract the serialized UI-wire round binds is
 * testable without React.
 *
 * Binding contract (committed A4e engine half,
 * `packages/office-engine/src/pptx/edits/format-edits.ts`): this panel emits
 * exactly that module's `FormatEdit` union, so the wire round is mechanical -
 * `model.applyEdit(edit)` with no translation layer in between:
 *   set_fill            solid / gradient / none
 *   set_stroke          colour + widthEmu + dash / none (null removes)
 *   set_effects         shadow / glow / softEdge (null clears)
 *   set_shape_geometry  prst passthrough
 *   set_text_anchor     top / middle / bottom
 *   set_text_body_props vert / autofit / insets / wrap
 *   group_elements / ungroup_element / flip_elements
 *   align_elements / distribute_elements
 *
 * Units: EMU throughout (the deck's own unit). Stroke width is entered in
 * points and converted here (12700 EMU = 1pt); nothing in this area depends on
 * a viewport width, so there is no px->EMU step.
 *
 * Vocabularies are imported from the A4e module, never re-declared, so a drift
 * in the engine's validators breaks this file loudly.
 */
import {
  PPTX_ALIGN_MODES,
  PPTX_FILL_ELEMENT_TYPES,
  PPTX_FLIP_AXES,
  PPTX_STROKE_ELEMENT_TYPES,
  PPTX_TEXT_ANCHORS,
  PPTX_TEXT_AUTOFIT,
  PPTX_TEXT_VERT,
  PptxEngineError,
  type FormatEdit,
  type PptxAlignMode,
  type PptxAlignTo,
  type PptxFlipAxis,
  type PptxGradientStop,
  type PptxTextAnchor,
  type PptxTextAutofit,
  type PptxTextBodyPropsPatch,
} from "@uniwork/office-engine/pptx";

/** EMU per point (12700) - the vendored stroke/inset unit. */
export const EMU_PER_POINT = 12700;

/** Dash presets the vendored `setStroke` accepts as a `prstDash` name. */
export const PPTX_FORMAT_DASHES = [
  "solid",
  "dash",
  "dot",
  "lgDash",
  "lgDashDot",
  "lgDashDotDot",
  "sysDash",
  "sysDot",
] as const;
export type PptxFormatDash = (typeof PPTX_FORMAT_DASHES)[number];

/**
 * The i18n key segment for each dash name. The engine names are camelCase
 * (`lgDash`), but an i18n key must satisfy the panel's lowercase key regex
 * (`/^office\.pptx\.format\.[a-z0-9_.]+$/`), so the segment is snake_case.
 */
const DASH_KEY_SEGMENTS: Record<PptxFormatDash, string> = {
  solid: "solid",
  dash: "dash",
  dot: "dot",
  lgDash: "lg_dash",
  lgDashDot: "lg_dash_dot",
  lgDashDotDot: "lg_dash_dot_dot",
  sysDash: "sys_dash",
  sysDot: "sys_dot",
};

/** The `office.pptx.format.dash.<segment>` key for a dash name. */
export function formatDashKey(dash: PptxFormatDash): string {
  return "office.pptx.format.dash." + DASH_KEY_SEGMENTS[dash];
}

/** i18n key segment for each align mode (engine camelCase -> snake_case). */
const ALIGN_KEY_SEGMENTS: Record<PptxAlignMode, string> = {
  left: "left",
  centerH: "center_h",
  right: "right",
  top: "top",
  centerV: "center_v",
  bottom: "bottom",
};

/** The `office.pptx.format.align.<segment>` key for an align mode. */
export function formatAlignKey(mode: PptxAlignMode): string {
  return "office.pptx.format.align." + ALIGN_KEY_SEGMENTS[mode];
}

/** A fill choice, in the shape `set_fill` takes. */
export type PptxFormatFill =
  | { kind: "none" }
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angleDeg: number; radial?: boolean };

/** A line choice, in the shape `set_stroke` takes. `none` removes the outline. */
export type PptxFormatStroke =
  | { kind: "none" }
  | { kind: "solid"; color: string; widthPt: number; dash?: PptxFormatDash };

/** A shadow choice for `set_effects`; `none` clears the effect. */
export interface PptxFormatShadow {
  color: string;
  blurPt: number;
  distPt: number;
  dirDeg: number;
  inner?: boolean;
}

/** An effects request; each key absent leaves that effect untouched, null clears. */
export interface PptxFormatEffects {
  shadow?: PptxFormatShadow | null;
  glow?: { color: string; radiusPt: number } | null;
  softEdgePt?: number | null;
}

/** Hex colour guard, mirroring the engine's `requireHexColor` (registry.ts:38). */
const HEX_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

/** True when `value` is a fill colour the format ops accept (alpha allowed). */
export function isFormatColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** "#rrggbb" -> "#RRGGBB"; anything else is returned trimmed and unchanged, so a
 * half-typed value in a field is never silently rewritten into a valid colour. */
export function normalizeFormatHex(value: string): string {
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return trimmed;
  return ("#" + trimmed.replace(/^#/, "")).toUpperCase();
}

/** The `type="color"` input value for a field: a valid "#RRGGBB" (the 8-digit
 * alpha form sliced to its RGB half), else the caller's fallback. */
export function formatColorInputValue(value: string, fallback: string): string {
  if (!isFormatColor(value)) return fallback;
  const normalized = normalizeFormatHex(value);
  return normalized.length > 7 ? normalized.slice(0, 7) : normalized;
}

/** Points -> EMU, rounded. Non-finite or non-positive input is refused by the builder. */
export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

/** EMU -> points, trimmed to at most two decimals ("1.5", "2"). */
export function emuToPoints(emu: number): string {
  if (!Number.isFinite(emu)) return "0";
  return String(Number((emu / EMU_PER_POINT).toFixed(2)));
}

/** A field value -> points, or null for anything that is not a positive number. */
export function parsePoints(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** A field value -> degrees normalized into [0, 360), or null. */
export function parseDegrees(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** A field value -> a finite non-negative number, or null. */
export function parseNonNegative(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * The honest refusal shape the engine throws: a `PptxEngineError` with a stable
 * `fmt_*` code. The model validates first so a bad field never reaches the deck;
 * the code is the same one `buildFormatOps` would answer.
 */
export function formatRefusal(code: string, message: string): PptxEngineError {
  return new PptxEngineError(code, message);
}

/** Element types `set_fill` accepts (the engine's plan-time gate). */
export function formatFillAllowed(elementType: string | null | undefined): boolean {
  return typeof elementType === "string" && (PPTX_FILL_ELEMENT_TYPES as readonly string[]).includes(elementType);
}

/** Element types `set_stroke` / `set_effects` accept. */
export function formatStrokeAllowed(elementType: string | null | undefined): boolean {
  return typeof elementType === "string" && (PPTX_STROKE_ELEMENT_TYPES as readonly string[]).includes(elementType);
}

/** True when `op` may target an element of `elementType`; the panel disables the
 * section instead of sending an edit the engine would refuse. */
export function formatOpAllowed(op: FormatEdit["op"], elementType: string | null | undefined): boolean {
  switch (op) {
    case "set_fill":
    case "set_text_anchor":
    case "set_text_body_props":
      return formatFillAllowed(elementType);
    case "set_stroke":
    case "set_effects":
    case "group_elements":
      return formatStrokeAllowed(elementType);
    case "ungroup_element":
      return elementType === "group";
    default:
      return true;
  }
}

/** Gradient stops from a from/to pair, normalized to uppercase hex. */
export function gradientStops(from: string, to: string): PptxGradientStop[] {
  return [
    { pos: 0, color: normalizeFormatHex(from) },
    { pos: 1, color: normalizeFormatHex(to) },
  ];
}

/** Gradient angle in degrees -> the 1/60000-degree unit the patch carries. */
export function gradientAngleUnits(degrees: number): number {
  return Math.round(degrees * 60000);
}

/** `set_fill` edit. Refuses an invalid colour (fmt_bad_color) or a bad angle
 * (fmt_bad_gradient) exactly where the engine would. */
export function buildFillEdit(slideIndex: number, elementId: string, fill: PptxFormatFill): FormatEdit {
  switch (fill.kind) {
    case "none":
      return { op: "set_fill", slideIndex, elementId, fill: "none" };
    case "solid": {
      if (!isFormatColor(fill.color)) {
        throw formatRefusal("fmt_bad_color", 'set_fill "fill.color" must be a hex color "#RRGGBB"');
      }
      return { op: "set_fill", slideIndex, elementId, fill: normalizeFormatHex(fill.color) };
    }
    case "gradient": {
      if (!isFormatColor(fill.from) || !isFormatColor(fill.to)) {
        throw formatRefusal("fmt_bad_color", 'set_fill gradient stops must be hex colors "#RRGGBB"');
      }
      if (!Number.isFinite(fill.angleDeg)) {
        throw formatRefusal("fmt_bad_gradient", 'set_fill "fill.angleDeg" must be a finite number');
      }
      return {
        op: "set_fill",
        slideIndex,
        elementId,
        fill: {
          stops: gradientStops(fill.from, fill.to),
          angle: gradientAngleUnits(fill.angleDeg),
          ...(fill.radial === true ? { radial: true } : {}),
        },
      };
    }
  }
}

/** `set_stroke` edit; `kind: "none"` emits the engine's null (remove outline). */
export function buildStrokeEdit(slideIndex: number, elementId: string, stroke: PptxFormatStroke): FormatEdit {
  if (stroke.kind === "none") {
    return { op: "set_stroke", slideIndex, elementId, stroke: null };
  }
  if (!isFormatColor(stroke.color)) {
    throw formatRefusal("fmt_bad_color", 'set_stroke "stroke.color" must be a hex color "#RRGGBB"');
  }
  const widthEmu = pointsToEmu(stroke.widthPt);
  if (!Number.isFinite(stroke.widthPt) || widthEmu <= 0) {
    throw formatRefusal("fmt_bad_stroke", 'set_stroke "stroke.widthPt" must be > 0 (12700 EMU = 1pt)');
  }
  return {
    op: "set_stroke",
    slideIndex,
    elementId,
    stroke: {
      color: normalizeFormatHex(stroke.color),
      widthEmu,
      ...(stroke.dash === undefined || stroke.dash === "solid" ? {} : { dash: stroke.dash }),
    },
  };
}

/** `set_effects` edit from the shadow / glow / soft-edge choices. */
export function buildEffectsEdit(slideIndex: number, elementId: string, effects: PptxFormatEffects): FormatEdit {
  const patch: Record<string, unknown> = {};
  if (effects.shadow !== undefined) {
    if (effects.shadow === null) {
      patch.shadow = null;
    } else {
      const shadow = effects.shadow;
      if (!isFormatColor(shadow.color)) {
        throw formatRefusal("fmt_bad_color", 'set_effects "effects.shadow.color" must be a hex color');
      }
      for (const [field, value] of Object.entries({ blurPt: shadow.blurPt, distPt: shadow.distPt, dirDeg: shadow.dirDeg })) {
        if (!Number.isFinite(value)) {
          throw formatRefusal("fmt_bad_effects", 'set_effects "effects.shadow.' + field + '" must be a finite number');
        }
      }
      patch.shadow = {
        color: normalizeFormatHex(shadow.color),
        blurRad: pointsToEmu(shadow.blurPt),
        dist: pointsToEmu(shadow.distPt),
        dirDeg: gradientAngleUnits(shadow.dirDeg),
        ...(shadow.inner === true ? { inner: true } : {}),
      };
    }
  }
  if (effects.glow !== undefined) {
    if (effects.glow === null) {
      patch.glow = null;
    } else {
      if (!isFormatColor(effects.glow.color)) {
        throw formatRefusal("fmt_bad_color", 'set_effects "effects.glow.color" must be a hex color');
      }
      if (!Number.isFinite(effects.glow.radiusPt) || effects.glow.radiusPt < 0) {
        throw formatRefusal("fmt_bad_effects", 'set_effects "effects.glow.radiusPt" must be a finite number');
      }
      patch.glow = { color: normalizeFormatHex(effects.glow.color), radius: pointsToEmu(effects.glow.radiusPt) };
    }
  }
  if (effects.softEdgePt !== undefined) {
    if (effects.softEdgePt === null) {
      patch.softEdge = null;
    } else {
      if (!Number.isFinite(effects.softEdgePt) || effects.softEdgePt < 0) {
        throw formatRefusal("fmt_bad_effects", 'set_effects "effects.softEdgePt" must be a finite number');
      }
      patch.softEdge = pointsToEmu(effects.softEdgePt);
    }
  }
  if (Object.keys(patch).length === 0) {
    throw formatRefusal("fmt_bad_effects", "set_effects needs at least one of shadow/glow/softEdge (null clears)");
  }
  return { op: "set_effects", slideIndex, elementId, effects: patch };
}

/** `set_shape_geometry` edit (preset geometry name passthrough). */
export function buildShapeGeometryEdit(slideIndex: number, elementId: string, prst: string): FormatEdit {
  if (typeof prst !== "string" || prst.trim().length === 0) {
    throw formatRefusal("fmt_bad_prst", 'set_shape_geometry "prst" must be a non-empty OOXML preset geometry name');
  }
  return { op: "set_shape_geometry", slideIndex, elementId, prst: prst.trim() };
}

/** `set_text_anchor` edit. */
export function buildTextAnchorEdit(slideIndex: number, elementId: string, anchor: PptxTextAnchor): FormatEdit {
  if (!(PPTX_TEXT_ANCHORS as readonly string[]).includes(anchor)) {
    throw formatRefusal("fmt_bad_anchor", 'set_text_anchor "anchor" must be one of ' + PPTX_TEXT_ANCHORS.join(", "));
  }
  return { op: "set_text_anchor", slideIndex, elementId, anchor };
}

/** `set_text_body_props` edit from a patch the caller assembled; refuses an
 * empty patch or an unknown vert/autofit value (fmt_bad_text_body). */
export function buildTextBodyPropsEdit(
  slideIndex: number,
  elementId: string,
  props: PptxTextBodyPropsPatch,
): FormatEdit {
  if (
    !props ||
    (props.vert === undefined && props.autofit === undefined && props.insets === undefined && props.wrap === undefined)
  ) {
    throw formatRefusal("fmt_bad_text_body", 'set_text_body_props "props" needs at least one of vert/autofit/insets/wrap');
  }
  if (props.vert !== undefined && !(PPTX_TEXT_VERT as readonly string[]).includes(props.vert)) {
    throw formatRefusal("fmt_bad_text_body", 'set_text_body_props "props.vert" must be one of ' + PPTX_TEXT_VERT.join(", "));
  }
  if (props.autofit !== undefined && !(PPTX_TEXT_AUTOFIT as readonly string[]).includes(props.autofit)) {
    throw formatRefusal("fmt_bad_text_body", 'set_text_body_props "props.autofit" must be one of ' + PPTX_TEXT_AUTOFIT.join(", "));
  }
  return { op: "set_text_body_props", slideIndex, elementId, props };
}

/** `set_text_body_props` for the wrap toggle alone. */
export function buildWrapEdit(slideIndex: number, elementId: string, wrap: boolean): FormatEdit {
  return buildTextBodyPropsEdit(slideIndex, elementId, { wrap });
}

/** `set_text_body_props` for an autofit mode. */
export function buildAutofitEdit(slideIndex: number, elementId: string, autofit: PptxTextAutofit): FormatEdit {
  return buildTextBodyPropsEdit(slideIndex, elementId, { autofit });
}

/** Distinct, non-empty ids in caller order; an empty entry is dropped. */
function uniqueIds(elementIds: readonly string[]): string[] {
  return [...new Set((elementIds ?? []).filter((id) => typeof id === "string" && id.length > 0))];
}

/** `group_elements` edit; refuses fewer than two ids (fmt_bad_els). */
export function buildGroupEdit(slideIndex: number, elementIds: readonly string[]): FormatEdit {
  const ids = uniqueIds(elementIds);
  if (ids.length < 2) {
    throw formatRefusal("fmt_bad_els", 'group_elements "elementIds" needs at least 2 element ids');
  }
  return { op: "group_elements", slideIndex, elementIds: ids };
}

/** `ungroup_element` edit (target must be a group; the engine checks). */
export function buildUngroupEdit(slideIndex: number, elementId: string): FormatEdit {
  return { op: "ungroup_element", slideIndex, elementId };
}

/** `flip_elements` edit. */
export function buildFlipEdit(slideIndex: number, elementIds: readonly string[], axis: PptxFlipAxis): FormatEdit {
  const ids = uniqueIds(elementIds);
  if (ids.length === 0) {
    throw formatRefusal("fmt_bad_els", 'flip_elements "elementIds" needs at least 1 element id');
  }
  if (!(PPTX_FLIP_AXES as readonly string[]).includes(axis)) {
    throw formatRefusal("fmt_bad_axis", 'flip_elements "axis" must be "h" or "v"');
  }
  return { op: "flip_elements", slideIndex, elementIds: ids, axis };
}

/** `align_elements` edit; the minimum id count follows the engine (2 for a
 * selection, 1 for the slide). */
export function buildAlignEdit(
  slideIndex: number,
  elementIds: readonly string[],
  mode: PptxAlignMode,
  to?: PptxAlignTo,
): FormatEdit {
  if (!(PPTX_ALIGN_MODES as readonly string[]).includes(mode)) {
    throw formatRefusal("fmt_bad_align", 'align_elements "mode" must be one of ' + PPTX_ALIGN_MODES.join(", "));
  }
  const ids = uniqueIds(elementIds);
  const min = to === "slide" ? 1 : 2;
  if (ids.length < min) {
    throw formatRefusal("fmt_bad_els", 'align_elements "elementIds" needs at least ' + min + " element id(s)");
  }
  return { op: "align_elements", slideIndex, elementIds: ids, mode, ...(to === undefined ? {} : { to }) };
}

/** `distribute_elements` edit; min 3 ids for a selection, 1 for the slide. */
export function buildDistributeEdit(
  slideIndex: number,
  elementIds: readonly string[],
  axis: "horizontal" | "vertical",
  to?: PptxAlignTo,
): FormatEdit {
  if (axis !== "horizontal" && axis !== "vertical") {
    throw formatRefusal("fmt_bad_axis", 'distribute_elements "axis" must be "horizontal" or "vertical"');
  }
  const ids = uniqueIds(elementIds);
  const min = to === "slide" ? 1 : 3;
  if (ids.length < min) {
    throw formatRefusal("fmt_bad_els", 'distribute_elements "elementIds" needs at least ' + min + " element id(s)");
  }
  return { op: "distribute_elements", slideIndex, elementIds: ids, axis, ...(to === undefined ? {} : { to }) };
}

/** Whether an arrange action can run for the current selection size. */
export function arrangeEnabled(
  action: "group" | "ungroup" | "flip" | "align" | "distribute",
  selectedCount: number,
  singleType?: string | null,
): boolean {
  switch (action) {
    case "group":
      return selectedCount >= 2;
    case "ungroup":
      return selectedCount === 1 && singleType === "group";
    case "flip":
      return selectedCount >= 1;
    case "align":
      return selectedCount >= 2;
    case "distribute":
      return selectedCount >= 3;
  }
}
