// UNI-952 (D3-xlsx): data bars and icon sets, printed as the grid draws them.
// The renderer's readPrintRange hands over what its conditional-formatting
// view model evaluated for each cell (the bar's colour and percentages, the
// icon's own data: URL, "show bar/icon only") - the same values the canvas
// extensions paint from; nothing is re-evaluated here. The geometry mirrors
// those painters: a bar inset 2px from every cell edge, growing right of its
// axis for positive values and left of it for negative ones, a white-ended
// gradient with a 1px outline when the rule asks for one; a 15px icon at the
// cell's left, vertically centred, dropped when the cell is too small for
// it, with the cell's text moved past it.
import { cssColor, escapeHtml, round } from "./print-styles";

/** One cell's data bar and/or icon (points and percentages as painted). */
export interface XlsxPrintMark {
  readonly dataBar?: { readonly color: string; readonly value: number; readonly startPoint: number; readonly isGradient: boolean } | undefined;
  readonly icon?: string | undefined;
  readonly hideValue?: boolean | undefined;
}

const PX = 0.75;
/** The painters' inset and icon size, in points at 100%. */
const INSET = 2 * PX;
const ICON = 15 * PX;
/** Univer's icon text offset (DEFAULT_PADDING + DEFAULT_WIDTH), in points. */
export const ICON_TEXT_OFFSET = 17 * PX;

/** The icon painter's own percent-encoded SVG, or a base64 raster. */
const ICON_SRC = /^(?:data:image\/svg\+xml;charset=utf-8,[A-Za-z0-9%._~!*'()-]+|data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2})$/;
const RGB = /^rgba?\(\s*\d{1,3}(?:\s*[,\s]\s*\d{1,3}){2}(?:\s*[,/]\s*(?:0|1|0?\.\d+))?\s*\)$/;

/** A painter colour ("#rgb", "#rrggbb", "rgb(...)") as safe CSS, else null. */
function barColor(value: string): string | null {
  const trimmed = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
  if (short) return `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}`;
  return cssColor(trimmed) ?? (RGB.test(trimmed) ? trimmed.replace(/\s+/g, " ") : null);
}

const clampPercent = (value: number): number => (Number.isFinite(value) ? Math.min(100, Math.max(-100, value)) : 0);

function barHtml(bar: NonNullable<XlsxPrintMark["dataBar"]>, width: number, scale: number): string {
  const color = barColor(bar.color);
  if (!color) return "";
  const inner = Math.max(0, width - 2 * INSET);
  const start = Math.min(100, Math.max(0, Number.isFinite(bar.startPoint) ? bar.startPoint : 0));
  const value = clampPercent(bar.value);
  const positive = value > 0;
  const length = Math.max(positive ? (inner * (1 - start / 100) * value) / 100 : (inner * (start / 100) * Math.abs(value)) / 100, PX);
  const axis = INSET + (start / 100) * inner;
  const left = positive ? axis : axis - length;
  const fill = bar.isGradient
    ? `background:linear-gradient(to ${positive ? "right" : "left"},${color},#ffffff);border:${PX}pt solid ${color}`
    : `background:${color}`;
  const radius = positive ? `0 ${PX}pt ${PX}pt 0` : `${PX}pt 0 0 ${PX}pt`;
  return `<div class="db" style="left:${round(left * scale)}pt;width:${round(length * scale)}pt;${fill};border-radius:${radius}"></div>`;
}

/** Whether the icon fits the cell the way the painter decides it. */
const iconFits = (width: number, height: number): boolean => ICON <= height && ICON <= width + 2 * INSET;

/** The bar and icon markup placed first inside a cell (`td.cf`); the cell's
 *  text follows in a positioned wrapper so it paints over the bar. */
export function markHtml(mark: XlsxPrintMark, box: { readonly width: number; readonly height: number }, scale: number): string {
  let html = mark.dataBar ? barHtml(mark.dataBar, box.width, scale) : "";
  if (mark.icon && ICON_SRC.test(mark.icon) && iconFits(box.width, box.height)) {
    const size = round(ICON * scale);
    html += `<img class="ic" alt="" src="${escapeHtml(mark.icon)}" style="left:${round(INSET * scale)}pt;width:${size}pt;height:${size}pt;margin-top:${round((-ICON / 2) * scale)}pt">`;
  }
  return html;
}

/** The stylesheet rules the marks use, at print scale `scale`. */
export function markRules(scale: number): string[] {
  return [
    "td.cf{position:relative}",
    `.db{position:absolute;top:${round(INSET * scale)}pt;bottom:${round(INSET * scale)}pt}`,
    ".ic{position:absolute;top:50%}",
    ".cv{position:relative}",
  ];
}
