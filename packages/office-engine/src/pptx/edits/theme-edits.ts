// B1e (UNI-927) — design ops (logic half): themes, slide size, backgrounds and
// slide layouts, bound one-to-one to the vendored pptx-ops registry.
//
// Vendored contract (READ ONLY — never imported; cited for every field):
//   applyTheme      packages/pptx-ops/src/ops/slide-ops.ts:730
//                   (validate 731-746: name non-empty, colors a slot → hex
//                   record; apply 747-774: commitSaved, patch theme parts,
//                   materialize backgrounds for slides without one; explicit
//                   srgbClr colors are NOT remapped — office-upstream patch
//                   0007 makes the vendored remap opt-in)
//   setSlideSize    packages/pptx-ops/src/ops/slide-ops.ts:318
//                   (validate 319-330: cx/cy must be finite and > 0)
//   setBackground   packages/pptx-ops/src/ops/slide-ops.ts:382
//                   (validate 383-413: solid color / gradient from+to+angle /
//                   image source / reset / graphics; hex guard is
//                   registry.ts:38-44 — "#RRGGBB" or "#RRGGBBAA"; apply
//                   414-455; one slide per op, slide-ops.ts:378-380)
//   setSlideLayout  packages/pptx-ops/src/ops/slide-ops.ts:296
//                   (validate 297-300; apply 301-314: layout name, 0-based
//                   index or part path via resolveLayoutPath 119-148; neither
//                   layout nor layoutPath resets to the master layout)
//
// The wire round registers `ThemeEdit` as PptxEdit kinds in model.ts and calls
//   this.txn(buildThemeOps(this.opened, this.fitWidthPx, edit))
//
// Everything here is EMU by design: themes, page size, backgrounds and layouts
// carry no pixel geometry, so no px→EMU conversion happens and `fitWidthPx`
// stays in the signature only because every engine-half builder shares the
// same mechanical wire call. `set_background` targets one slide per op; a
// `slideIndex` array fans out to one op per slide so "apply to all" is one
// atomic transaction.
import { PptxEngineError, type OpenedPptxLike, type PptxOp } from "../engine";

/** Scheme slot → hex color. Vendored applyTheme accepts "#RRGGBB" or
 * "RRGGBB" (slide-ops.ts:742); slot names are the theme scheme's
 * dk1/lt1/dk2/lt2/accent1..6/hlink/folHlink (slide-ops.ts:738 error text). */
export type ThemeColorMap = Record<string, string>;

/** The edit kinds this module builds (registered as PptxEdit kinds by the
 * wire round):
 *  - apply_theme      -> vendored `applyTheme` (deck-level, no target);
 *  - set_slide_size   -> vendored `setSlideSize` (deck-level, EMU);
 *  - set_background   -> vendored `setBackground` (one op per slide; pass an
 *                        index array to apply the same background to all);
 *  - set_slide_layout -> vendored `setSlideLayout` (layout name/index/path or
 *                        reset to the master layout). */
export type ThemeEdit =
  | { op: "apply_theme"; name: string; colors: ThemeColorMap; majorFont?: string; minorFont?: string }
  | { op: "set_slide_size"; cxEmu: number; cyEmu: number }
  | {
      op: "set_background";
      slideIndex: number | number[];
      kind: "solid" | "gradient" | "image" | "reset" | "graphics";
      /** solid fill color — "#RRGGBB"/"#RRGGBBAA" (registry.ts:39). */
      color?: string;
      /** gradient stop 0 color (registry.ts:39). */
      from?: string;
      /** gradient stop 1 color (registry.ts:39). */
      to?: string;
      /** gradient angle in degrees; finite when present. */
      angleDeg?: number;
      /** radial gradient instead of a linear one. */
      radial?: boolean;
      /** image source bytes — required for kind "image". */
      bytes?: Uint8Array;
      /** image extension (e.g. "png") — required for kind "image". */
      ext?: string;
      /** tile the image background instead of stretching it. */
      tile?: boolean;
      /** graphics kind: true hides master/layout background graphics. */
      hidden?: boolean;
    }
  | { op: "set_slide_layout"; slideIndex: number; layout?: string | number; reset?: boolean };

/** Vendored applyTheme accepts exactly 6 hex digits, optional "#" (slide-ops.ts:742). */
const THEME_COLOR_RE = /^#?[0-9A-Fa-f]{6}$/;
/** Vendored requireHexColor accepts "#RRGGBB" or "#RRGGBBAA" (registry.ts:39). */
const FILL_COLOR_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

const badThemeColor = (detail: string): PptxEngineError =>
  new PptxEngineError("bad_theme_color", "apply_theme " + detail);

/** Record guard + per-value hex guard, mirroring the vendored validate loop
 * (slide-ops.ts:735-745). Slot names are not restricted there either — the
 * scheme's slot set is a convention, not a validation rule. */
const requireThemeColors = (colors: unknown): ThemeColorMap => {
  if (typeof colors !== "object" || colors === null || Array.isArray(colors)) {
    throw badThemeColor('"colors" must be a scheme-slot → "#RRGGBB" record');
  }
  for (const [slot, value] of Object.entries(colors)) {
    if (typeof value !== "string" || !THEME_COLOR_RE.test(value)) {
      throw badThemeColor('colors.' + slot + ' must be a "#RRGGBB" string');
    }
  }
  return colors as ThemeColorMap;
};

/** Slide existence guard — no_slide for a missing/non-integer index. */
const requireSlideIndex = (opened: OpenedPptxLike, index: unknown): number => {
  const slide = typeof index === "number" && Number.isInteger(index) && index >= 0 ? opened.deck.slides[index] : undefined;
  if (!slide) {
    throw new PptxEngineError("no_slide", "slide index " + String(index) + " does not exist");
  }
  return index as number;
};

/** Background/gradient color guard — vendored requireHexColor (registry.ts:39). */
const requireFillColor = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !FILL_COLOR_RE.test(value)) {
    throw new PptxEngineError("bad_background", field + ' must be a hex color "#RRGGBB" or "#RRGGBBAA"');
  }
  return value;
};

function buildApplyTheme(edit: Extract<ThemeEdit, { op: "apply_theme" }>): PptxOp[] {
  if (typeof edit.name !== "string" || edit.name.trim().length === 0) {
    throw new PptxEngineError("bad_theme_name", 'apply_theme "name" must be a non-empty string');
  }
  return [
    {
      op: "applyTheme",
      name: edit.name,
      colors: requireThemeColors(edit.colors),
      // Empty font names are omitted — the vendored apply does the same
      // (slide-ops.ts:751-752), so a blank field means "keep the theme fonts".
      ...(typeof edit.majorFont === "string" && edit.majorFont.length > 0 ? { majorFont: edit.majorFont } : {}),
      ...(typeof edit.minorFont === "string" && edit.minorFont.length > 0 ? { minorFont: edit.minorFont } : {}),
    },
  ];
}

function buildSetSlideSize(edit: Extract<ThemeEdit, { op: "set_slide_size" }>): PptxOp[] {
  const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (!positive(edit.cxEmu) || !positive(edit.cyEmu)) {
    throw new PptxEngineError("bad_slide_size", "set_slide_size needs positive finite cxEmu/cyEmu (EMU)");
  }
  return [{ op: "setSlideSize", cx: edit.cxEmu, cy: edit.cyEmu }];
}

/** Validated payload shared by every op of one set_background edit (the
 * shape after `kind`, mirroring vendored validate + apply, slide-ops.ts:383-455). */
function backgroundPayload(edit: Extract<ThemeEdit, { op: "set_background" }>): Record<string, unknown> {
  switch (edit.kind) {
    case "solid":
      return { kind: "solid", color: requireFillColor(edit.color, "color") };
    case "gradient": {
      const from = requireFillColor(edit.from, "from");
      const to = requireFillColor(edit.to, "to");
      if (edit.angleDeg !== undefined && (typeof edit.angleDeg !== "number" || !Number.isFinite(edit.angleDeg))) {
        throw new PptxEngineError("bad_background", "gradient angleDeg must be a finite number");
      }
      return {
        kind: "gradient",
        from,
        to,
        ...(edit.angleDeg === undefined ? {} : { angleDeg: edit.angleDeg }),
        ...(edit.radial === true ? { radial: true } : {}),
      };
    }
    case "image": {
      if (!(edit.bytes instanceof Uint8Array) || edit.bytes.length === 0) {
        throw new PptxEngineError("bad_background", "image background needs non-empty image bytes");
      }
      if (typeof edit.ext !== "string" || edit.ext.trim().length === 0) {
        throw new PptxEngineError("bad_background", 'image background needs source extension "ext"');
      }
      return {
        kind: "image",
        source: { bytes: edit.bytes, ext: edit.ext },
        ...(edit.tile === true ? { tile: true } : {}),
      };
    }
    case "reset":
      return { kind: "reset" };
    case "graphics":
      return { kind: "graphics", hidden: edit.hidden === true };
    default:
      throw new PptxEngineError("bad_background", "unknown background kind " + String((edit as { kind?: unknown }).kind));
  }
}

function buildSetBackground(opened: OpenedPptxLike, edit: Extract<ThemeEdit, { op: "set_background" }>): PptxOp[] {
  const refs = Array.isArray(edit.slideIndex) ? edit.slideIndex : [edit.slideIndex];
  if (refs.length === 0) {
    throw new PptxEngineError("no_slide", "set_background needs at least one slide");
  }
  const slides = refs.map((ref) => requireSlideIndex(opened, ref));
  const payload = backgroundPayload(edit);
  return slides.map((slide) => ({ op: "setBackground", target: { slide }, ...payload }));
}

function buildSetSlideLayout(opened: OpenedPptxLike, edit: Extract<ThemeEdit, { op: "set_slide_layout" }>): PptxOp[] {
  const slide = requireSlideIndex(opened, edit.slideIndex);
  if (edit.reset === true) {
    if (edit.layout !== undefined) {
      throw new PptxEngineError("bad_layout", 'set_slide_layout takes "layout" or "reset", not both');
    }
    // Neither layout nor layoutPath resets to the master layout (slide-ops.ts:303-307).
    return [{ op: "setSlideLayout", target: { slide } }];
  }
  if (typeof edit.layout === "number") {
    if (!Number.isInteger(edit.layout) || edit.layout < 0) {
      throw new PptxEngineError("bad_layout", "set_slide_layout layout index must be a non-negative integer");
    }
    return [{ op: "setSlideLayout", target: { slide }, layout: edit.layout }];
  }
  if (typeof edit.layout === "string" && edit.layout.trim().length > 0) {
    return [{ op: "setSlideLayout", target: { slide }, layout: edit.layout }];
  }
  throw new PptxEngineError("bad_layout", 'set_slide_layout needs a non-empty layout name/index/path or "reset": true');
}

/** One validated design edit → the vendored op(s) the executor runs. Refusals
 * are typed PptxEngineError codes: bad_theme_name / bad_theme_color
 * (apply_theme), bad_slide_size (set_slide_size), bad_background
 * (set_background payload), bad_layout (set_slide_layout target), no_slide
 * (slide index missing from the deck). EMU values pass through unconverted
 * (see the module header). */
export function buildThemeOps(opened: OpenedPptxLike, fitWidthPx: number, edit: ThemeEdit): PptxOp[] {
  // Geometry-free kinds: nothing to convert. `void` keeps the uniform wire
  // signature honest about the deliberate non-use.
  void fitWidthPx;
  switch (edit.op) {
    case "apply_theme":
      return buildApplyTheme(edit);
    case "set_slide_size":
      return buildSetSlideSize(edit);
    case "set_background":
      return buildSetBackground(opened, edit);
    case "set_slide_layout":
      return buildSetSlideLayout(opened, edit);
  }
  throw new PptxEngineError("unsupported_edit", "no design-op builder for the given edit kind");
}
