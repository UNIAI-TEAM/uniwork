// UNI-952 (D-xlsx): page layout of one printed sheet. Pure arithmetic: which
// columns and rows land on which page, at which scale. Excel's rules, kept:
// fit-to-page shrinks (never grows) to fit N pages wide / M tall and ignores
// manual breaks; a fixed scale honours them; pages run down, then over; title
// rows repeat on every page that does not already start with them, title
// columns on every page that does not already start with them.
import type { XlsxResolvedPrintSetup } from "./print-setup";

/** Lengths are points (1/72 in) at 100%. */
export interface XlsxPrintGeometry {
  /** Visible columns of the printed range, in order, with their widths. */
  readonly columns: readonly { readonly index: number; readonly width: number }[];
  /** Visible rows of the printed range, in order, with their heights. */
  readonly rows: readonly { readonly index: number; readonly height: number }[];
  /** Visible title rows (repeated at the top), in order. */
  readonly titleRows: readonly { readonly index: number; readonly height: number }[];
  /** Visible title columns (repeated at the left), in order. */
  readonly titleColumns: readonly { readonly index: number; readonly width: number }[];
  /** Row-heading column width and column-heading row height (0 when off). */
  readonly headingWidth: number;
  readonly headingHeight: number;
}

export interface XlsxPrintPage {
  readonly columns: readonly number[];
  readonly rows: readonly number[];
  /** Title rows prepended to this page (empty when it starts with them). */
  readonly titleRows: readonly number[];
  /** Title columns prepended to this page (empty when it starts with them). */
  readonly titleColumns: readonly number[];
}

interface XlsxPrintLayout {
  /** Effective scale factor (1 = 100%). */
  readonly scale: number;
  readonly pages: readonly XlsxPrintPage[];
}

const PT_PER_INCH = 72;
const MIN_SCALE = 0.1;

const sum = (values: readonly { readonly width?: number; readonly height?: number }[], key: "width" | "height"): number =>
  values.reduce((total, value) => total + (value[key] ?? 0), 0);

/** Printable area in points: paper minus margins. */
export function printableArea(setup: XlsxResolvedPrintSetup): { width: number; height: number } {
  return {
    width: Math.max(PT_PER_INCH, (setup.paper.width - setup.margins.left - setup.margins.right) * PT_PER_INCH),
    height: Math.max(PT_PER_INCH, (setup.paper.height - setup.margins.top - setup.margins.bottom) * PT_PER_INCH),
  };
}

/** The scale one area prints at (1 = 100%). */
export function effectiveScale(setup: XlsxResolvedPrintSetup, geometry: XlsxPrintGeometry): number {
  if (!setup.fit) return Math.min(4, Math.max(MIN_SCALE, setup.scale / 100));
  const area = printableArea(setup);
  const totalWidth = sum(geometry.columns, "width") + geometry.headingWidth;
  const totalHeight = sum(geometry.rows, "height") + geometry.headingHeight;
  const byWidth = setup.fit.width > 0 && totalWidth > 0 ? (area.width * setup.fit.width) / totalWidth : Infinity;
  const byHeight = setup.fit.height > 0 && totalHeight > 0 ? (area.height * setup.fit.height) / totalHeight : Infinity;
  // Excel's fit only shrinks; it floors at 10%.
  return Math.max(MIN_SCALE, Math.min(1, byWidth, byHeight));
}

/** Split sized items into runs that fit `limit`, breaking before any index in
 *  `breaks`. A run that starts after the last title item reserves room for
 *  the titles (unless they could never fit) and carries them. An item larger
 *  than the room gets a run of its own. */
function runs(
  items: readonly { readonly index: number; readonly size: number }[],
  limit: number,
  breaks: ReadonlySet<number>,
  titles: readonly { readonly index: number; readonly size: number }[],
): { items: number[]; titles: readonly number[] }[] {
  const titleSize = titles.reduce((total, title) => total + title.size, 0);
  const titleIndexes = titles.map((title) => title.index);
  const lastTitle = titleIndexes[titleIndexes.length - 1];
  const needsTitles = (first: number): boolean => lastTitle !== undefined && first > lastTitle && titleSize < limit;
  const out: { items: number[]; titles: readonly number[] }[] = [];
  let current: number[] = [];
  let used = 0;
  let reserve = 0;
  const close = (): void => {
    if (current.length === 0) return;
    out.push({ items: current, titles: needsTitles(current[0]!) ? titleIndexes : [] });
    current = [];
    used = 0;
  };
  for (const item of items) {
    if (current.length > 0 && (breaks.has(item.index) || used + item.size > limit - reserve + 0.01)) close();
    if (current.length === 0) reserve = needsTitles(item.index) ? titleSize : 0;
    current.push(item.index);
    used += item.size;
  }
  close();
  return out;
}

/** Lay one area out into pages, at `scale` when given (a multi-area print
 *  shares the smallest scale of its areas), else its own. */
export function layoutPrintPages(setup: XlsxResolvedPrintSetup, geometry: XlsxPrintGeometry, scale = effectiveScale(setup, geometry)): XlsxPrintLayout {
  const area = printableArea(setup);
  // Work in sheet points: the page holds area / scale of them.
  const width = area.width / scale - geometry.headingWidth;
  const height = area.height / scale - geometry.headingHeight;
  const manual = setup.fit === null;
  const columnRuns = runs(
    geometry.columns.map((column) => ({ index: column.index, size: column.width })),
    width,
    new Set(manual ? setup.colBreaks : []),
    geometry.titleColumns.map((column) => ({ index: column.index, size: column.width })),
  );
  const rowRuns = runs(
    geometry.rows.map((row) => ({ index: row.index, size: row.height })),
    height,
    new Set(manual ? setup.rowBreaks : []),
    geometry.titleRows.map((row) => ({ index: row.index, size: row.height })),
  );

  const pages: XlsxPrintPage[] = [];
  for (const columns of columnRuns.length > 0 ? columnRuns : [{ items: [], titles: [] }]) {
    for (const rows of rowRuns.length > 0 ? rowRuns : [{ items: [], titles: [] }]) {
      pages.push({ columns: columns.items, rows: rows.items, titleRows: rows.titles, titleColumns: columns.titles });
    }
  }
  return { scale, pages };
}

