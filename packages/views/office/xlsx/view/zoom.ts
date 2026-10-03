/** View-only zoom logic for the XLSX toolbar. Zoom is session view state:
 *  it rides the allowlisted `sheet.command.change-zoom-ratio` view command and
 *  is never journaled, persisted or sent through the save path. */

export const XLSX_ZOOM_COMMAND = "sheet.command.change-zoom-ratio";

/** The renderer clamps zoom to this percent range (the pin's SHEET_ZOOM_RANGE). */
export const XLSX_ZOOM_MIN = 10;
export const XLSX_ZOOM_MAX = 400;
export const XLSX_ZOOM_DEFAULT = 100;
export const XLSX_ZOOM_STEP = 10;
export const XLSX_ZOOM_PRESETS = [50, 75, 100, 125, 150, 200] as const;

export function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) return XLSX_ZOOM_DEFAULT;
  return Math.min(XLSX_ZOOM_MAX, Math.max(XLSX_ZOOM_MIN, Math.round(percent)));
}

export function stepZoom(current: number, direction: 1 | -1): number {
  return clampZoom(current + direction * XLSX_ZOOM_STEP);
}

/** The ratio-unit delta `sheet.command.change-zoom-ratio` needs to land on
 *  `next` from `current` (the pin computes `round((zoomRatio + delta) * 100)`). */
export function zoomRatioDelta(current: number, next: number): number {
  return (clampZoom(next) - clampZoom(current)) / 100;
}
