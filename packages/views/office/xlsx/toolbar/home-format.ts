// Pure data and helpers for the Home formatting groups. The colour values
// here are workbook data written into cells; the UI chrome around them stays
// on semantic tokens.

/** Excel's standard colour row plus the neutral ramp, offered by both the
 *  text and fill pickers. */
export const XLSX_PALETTE_COLORS: readonly string[] = [
  "#FFFFFF", "#000000", "#BFBFBF", "#808080", "#404040",
  "#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050",
  "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0",
];

/** Font families the Home picker offers (Excel-safe faces; the renderer
 *  falls back for faces the workbook carries but this list lacks). */
export const XLSX_FONT_FAMILIES: readonly string[] = [
  "Calibri", "Arial", "Times New Roman", "Verdana", "Tahoma", "Courier New",
];

/** Shown when the active cell declares no explicit family. */
export const XLSX_DEFAULT_FONT_FAMILY = "Calibri";

/** Excel's default body size; used when the active cell declares none. */
export const XLSX_DEFAULT_FONT_SIZE = 11;

const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 409;

/** Clamp a typed size to the OOXML range (points, integer). */
export function clampFontSize(value: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}

/** Next size for the +/- stepper; an unknown current size steps from the
 *  Excel default. */
export function stepFontSize(current: number | null, delta: number): number {
  return clampFontSize((current ?? XLSX_DEFAULT_FONT_SIZE) + delta);
}

/** Common rotation angles in degrees (negative = counter-clockwise). */
export const XLSX_TEXT_ROTATIONS: readonly number[] = [0, 45, 90, -45, -90];

/** Pinned Univer style values mirrored back from the renderer. */
export const XLSX_HORIZONTAL_ALIGN = { left: 1, center: 2, right: 3 } as const;
export const XLSX_VERTICAL_ALIGN = { top: 1, middle: 2, bottom: 3 } as const;
export const XLSX_WRAP_STRATEGY = { overflow: 1, clip: 2, wrap: 3 } as const;
