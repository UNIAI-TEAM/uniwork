/**
 * Design panel model (B1 UI half, UNI-927) - the pure half of the Design tab.
 *
 * Everything here is data or a pure function so the gallery, the size control,
 * the layout picker and the background dialog stay presentational and the
 * contract the serialized UI-wire round binds is testable without React.
 *
 * Binding contract (committed B1e engine half,
 * `packages/office-engine/src/pptx/edits/theme-edits.ts`): this panel emits
 * exactly that module's `ThemeEdit` union, so the wire round is mechanical -
 * `model.applyEdit(edit)` with no translation layer in between:
 *   apply_theme       -> { op: "apply_theme", name, colors, majorFont?, minorFont? }
 *   set_slide_size    -> { op: "set_slide_size", cxEmu, cyEmu }      (EMU, no px)
 *   set_background    -> { op: "set_background", slideIndex, kind, ... }
 *   set_slide_layout  -> { op: "set_slide_layout", slideIndex, layout? , reset? }
 *
 * "Apply to all" is the engine builder's own fan-out: one `set_background` edit
 * whose `slideIndex` is an index ARRAY becomes one op per slide inside ONE
 * atomic transaction (theme-edits.ts header). The panel never loops and never
 * issues N transactions.
 *
 * Sizes are EMU throughout - the deck's own unit. There is no px->EMU step in
 * this area (the engine module documents the same), so nothing here depends on
 * a viewport width.
 */
import type { ThemeEdit } from "@uniwork/office-engine/pptx";

/** EMU per inch (OOXML `a:xfrm` unit) - used only for the size readout copy. */
export const EMU_PER_INCH = 914400;

/** One built-in theme the gallery offers. Colors are the 12 scheme slots
 * (`#RRGGBB`), matching the vendored `applyTheme` guard (slide-ops.ts:742). */
export interface PptxDesignTheme {
  id: string;
  /** i18next key under office.pptx.design.theme.<id>. */
  nameKey: string;
  colors: Record<string, string>;
  majorFont?: string;
  minorFont?: string;
}

/** Built-in theme presets. Slot semantics: dk1 body text, lt1 page background,
 * dk2/lt2 secondary dark/light, accent1..6 accents, hlink/folHlink links. */
export const PPTX_DESIGN_THEMES: readonly PptxDesignTheme[] = [
  {
    id: "office",
    nameKey: "office.pptx.design.theme.office",
    colors: {
      dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6",
      accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5",
      accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47",
      hlink: "0563C1", folHlink: "954F72",
    },
    majorFont: "Calibri Light",
    minorFont: "Calibri",
  },
  {
    id: "slate",
    nameKey: "office.pptx.design.theme.slate",
    colors: {
      dk1: "1F2937", lt1: "FFFFFF", dk2: "475569", lt2: "E2E8F0",
      accent1: "334155", accent2: "0EA5E9", accent3: "64748B",
      accent4: "F59E0B", accent5: "14B8A6", accent6: "8B5CF6",
      hlink: "0284C7", folHlink: "7C3AED",
    },
    majorFont: "Segoe UI Semibold",
    minorFont: "Segoe UI",
  },
  {
    id: "forest",
    nameKey: "office.pptx.design.theme.forest",
    colors: {
      dk1: "14261A", lt1: "FFFFFF", dk2: "2F5D3A", lt2: "E8F2EA",
      accent1: "1E7A46", accent2: "4EA72E", accent3: "8FBF4A",
      accent4: "D9A521", accent5: "2F8F86", accent6: "6BA84F",
      hlink: "1E7A46", folHlink: "7A5AA8",
    },
    majorFont: "Georgia",
    minorFont: "Verdana",
  },
  {
    id: "ember",
    nameKey: "office.pptx.design.theme.ember",
    colors: {
      dk1: "2B1B14", lt1: "FFFBF7", dk2: "7A3B22", lt2: "F7EBE6",
      accent1: "C43E1C", accent2: "E97132", accent3: "F2A65A",
      accent4: "B45309", accent5: "9A3412", accent6: "A33517",
      hlink: "C43E1C", folHlink: "954F72",
    },
    majorFont: "Trebuchet MS",
    minorFont: "Calibri",
  },
  {
    id: "indigo",
    nameKey: "office.pptx.design.theme.indigo",
    colors: {
      dk1: "1E1B4B", lt1: "FFFFFF", dk2: "3730A3", lt2: "E8ECFB",
      accent1: "4338CA", accent2: "6366F1", accent3: "818CF8",
      accent4: "0EA5E9", accent5: "06B6D4", accent6: "8B5CF6",
      hlink: "4338CA", folHlink: "7C3AED",
    },
    majorFont: "Segoe UI",
    minorFont: "Segoe UI",
  },
  {
    id: "midnight",
    nameKey: "office.pptx.design.theme.midnight",
    colors: {
      dk1: "EAF2FF", lt1: "0F1C2E", dk2: "BCD0EC", lt2: "1E3350",
      accent1: "4A9EDE", accent2: "63C7B2", accent3: "F2C14E",
      accent4: "E4718D", accent5: "9B8CDE", accent6: "7FB069",
      hlink: "6FB3EC", folHlink: "B08CDE",
    },
    majorFont: "Calibri Light",
    minorFont: "Calibri",
  },
];

/** One slide-size preset; `cxEmu`/`cyEmu` are the vendored `setSlideSize` fields. */
export interface PptxDesignSlideSize {
  id: string;
  /** i18next key under office.pptx.design.size.<id>. */
  labelKey: string;
  cxEmu: number;
  cyEmu: number;
}

/** Office 16:9 (widescreen) and 4:3 (standard) - the two sizes PowerPoint offers. */
export const PPTX_DESIGN_SLIDE_SIZES: readonly PptxDesignSlideSize[] = [
  { id: "16_9", labelKey: "office.pptx.design.size.16_9", cxEmu: 12192000, cyEmu: 6858000 },
  { id: "4_3", labelKey: "office.pptx.design.size.4_3", cxEmu: 9144000, cyEmu: 6858000 },
];

/** One entry of the host's layout catalog (`listSlideLayouts` shape). */
export interface PptxDesignLayout {
  name: string;
  /** Part path (`ppt/slideLayouts/slideLayoutN.xml`) - what `setSlideLayout` resolves. */
  path: string;
}

/** A background fill choice, in the shape the engine's `set_background` takes. */
export type PptxDesignBackgroundFill =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angleDeg?: number; radial?: boolean }
  | { kind: "image"; bytes: Uint8Array; ext: string; tile?: boolean }
  | { kind: "reset" };

/** One background request: the fill plus which slides it targets. Passing more
 * than one index is the engine's "apply to all" fan-out, not a panel loop. */
export interface PptxDesignBackgroundRequest {
  fill: PptxDesignBackgroundFill;
  slideIndexes: readonly number[];
}

/** Vendored `requireHexColor` accepts "#RRGGBB" or "#RRGGBBAA" (registry.ts:39);
 * the `applyTheme` guard accepts the same 6-digit form (slide-ops.ts:742). */
const FILL_HEX_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

/** True when `value` is a fill color the background op accepts (alpha allowed). */
export function isFillColor(value: string): boolean {
  return FILL_HEX_RE.test(value);
}

/** "#rrggbb" -> "#RRGGBB"; anything else is returned trimmed and unchanged so a
 * half-typed value in a field is never silently rewritten into a valid color. */
export function normalizeHex(value: string): string {
  const trimmed = value.trim();
  if (!FILL_HEX_RE.test(trimmed)) return trimmed;
  return ("#" + trimmed.replace(/^#/, "")).toUpperCase();
}

/** 0-based indexes of every slide, for the "apply to all" fan-out. */
export function slideIndexRange(count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  return Array.from({ length: Math.floor(count) }, (_value, index) => index);
}

/** The preset id matching an EMU slide size, or null for a custom size. */
export function matchSlideSizePreset(
  size: { cx: number; cy: number } | null | undefined,
): string | null {
  if (!size) return null;
  const hit = PPTX_DESIGN_SLIDE_SIZES.find((preset) => preset.cxEmu === size.cx && preset.cyEmu === size.cy);
  return hit ? hit.id : null;
}

/** EMU -> inches, trimmed to at most two decimals ("13.33", "10", "7.5"). */
export function emuToInches(emu: number): string {
  if (!Number.isFinite(emu)) return "0";
  const inches = emu / EMU_PER_INCH;
  return String(Number(inches.toFixed(2)));
}

/** Colours a gallery card paints: page background, body text and four accents.
 * Pure so the card's swatch is testable without a DOM. */
export function themeSwatch(theme: PptxDesignTheme): {
  background: string;
  foreground: string;
  accents: string[];
} {
  const pick = (slot: string, fallback: string): string => normalizeHex(theme.colors[slot] ?? fallback);
  return {
    background: pick("lt1", "#FFFFFF"),
    foreground: pick("dk1", "#000000"),
    accents: ["accent1", "accent2", "accent3", "accent4"].map((slot) => pick(slot, "#888888")),
  };
}

/**
 * Roving-focus step for a vertical/horizontal option list (WAI-ARIA radiogroup
 * pattern): arrows move with wrap-around, Home/End jump to the ends, and any
 * other key returns null so the caller leaves the event alone. Kept here (not
 * shared with the ribbon) so the panel stays self-contained.
 */
export function nextRovingIndex(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return index >= last ? 0 : index + 1;
    case "ArrowLeft":
    case "ArrowUp":
      return index <= 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/** The option a group focuses on entry: the checked one, else the first. */
export function rovingEntryIndex(checkedIndex: number, count: number): number {
  return checkedIndex >= 0 && checkedIndex < count ? checkedIndex : 0;
}

/** `apply_theme` edit for one preset (deck-level; the engine rewrites theme parts). */
export function buildThemeEdit(theme: PptxDesignTheme): ThemeEdit {
  return {
    op: "apply_theme",
    name: theme.id,
    colors: { ...theme.colors },
    ...(theme.majorFont ? { majorFont: theme.majorFont } : {}),
    ...(theme.minorFont ? { minorFont: theme.minorFont } : {}),
  };
}

/** `set_slide_size` edit (EMU passthrough - no px conversion in this area). */
export function buildSlideSizeEdit(cxEmu: number, cyEmu: number): ThemeEdit {
  return { op: "set_slide_size", cxEmu, cyEmu };
}

/** `set_slide_layout` edit for a layout part path, or the master reset when
 * `layout` is omitted. */
export function buildLayoutEdit(slideIndex: number, layout?: string | number): ThemeEdit {
  return layout === undefined
    ? { op: "set_slide_layout", slideIndex, reset: true }
    : { op: "set_slide_layout", slideIndex, layout };
}

/**
 * `set_background` edit from a panel request. One index stays a number (one
 * op); several become an array so the engine fans out inside one transaction.
 */
export function buildBackgroundEdit(request: PptxDesignBackgroundRequest): ThemeEdit {
  const refs = request.slideIndexes;
  const slideIndex = refs.length === 1 ? (refs[0] as number) : [...refs];
  const { fill } = request;
  switch (fill.kind) {
    case "solid":
      return { op: "set_background", slideIndex, kind: "solid", color: fill.color };
    case "gradient":
      return {
        op: "set_background",
        slideIndex,
        kind: "gradient",
        from: fill.from,
        to: fill.to,
        ...(fill.angleDeg === undefined ? {} : { angleDeg: fill.angleDeg }),
        ...(fill.radial === true ? { radial: true } : {}),
      };
    case "image":
      return {
        op: "set_background",
        slideIndex,
        kind: "image",
        bytes: fill.bytes,
        ext: fill.ext,
        ...(fill.tile === true ? { tile: true } : {}),
      };
    case "reset":
      return { op: "set_background", slideIndex, kind: "reset" };
  }
}

/** `set_background` graphics edit: hide/show the master background graphics. */
export function buildGraphicsHiddenEdit(hidden: boolean, slideIndexes: readonly number[]): ThemeEdit {
  const slideIndex = slideIndexes.length === 1 ? (slideIndexes[0] as number) : [...slideIndexes];
  return { op: "set_background", slideIndex, kind: "graphics", hidden };
}

/** Gradient angle from a field value: a finite degree count normalized into
 * [0, 360), or null for anything that is not a number (the caller keeps the
 * last valid angle rather than sending NaN to the op). */
export function parseAngleDeg(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
/** Lower-case image extension from a file name/type, without the dot; "png"
 * when neither carries one (the vendored op requires a non-empty ext). */
export function imageExtension(fileName: string, mimeType?: string): string {
  const fromName = /\.([A-Za-z0-9]+)$/.exec(fileName.trim())?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromMime = mimeType ? /^image\/([A-Za-z0-9.+-]+)$/.exec(mimeType.trim())?.[1] : undefined;
  if (fromMime) return fromMime.toLowerCase();
  return "png";
}