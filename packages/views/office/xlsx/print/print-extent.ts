// UNI-953 (review-delta-r5 M1): how far a sheet's charts, pictures and shapes
// reach, in print's own row and column sizes, so the default print range can
// grow over them as Excel's does. A two-cell anchor ends at its `to` marker,
// but a oneCell anchor is only its from cell and an absolute one the zero
// anchor: their size is an extent (and a position), which only the box the
// visuals layer measures carries. So the box is measured with print's sizes
// (hidden rows/columns count 0) and its far edge is turned back into a row
// and a column. The sizes come from narrow reads (one column of rows, one row
// of columns) taken before the cells are read, extended until the edge falls
// inside what was read.
// A visual that would push the range past MAX_PRINT_CELLS is left out of it
// (review m2): it does not print, but the cells still do, where growing over
// it would refuse the whole print. Excel would print blank pages up to it.
import { MAX_PRINT_CELLS } from "./print-copy";
import { XlsxPrintOffsets, type XlsxPrintableVisuals } from "./print-visuals";

type Extent = { readonly endRow: number; readonly endColumn: number };
type RowSize = { readonly height?: number | undefined; readonly hidden?: boolean | undefined };
type ColumnSize = { readonly width?: number | undefined; readonly hidden?: boolean | undefined };

interface XlsxDrawnExtentInput {
  readonly visuals: XlsxPrintableVisuals;
  /** The ids the printed sheet goes by (grid id, file id). */
  readonly sheetIds: readonly string[];
  /** The end of the cells' used range; the drawn extent grows from it. */
  readonly used: Extent;
  /** Print's sizes in points for rows / columns start..end (absent = default). */
  readonly readRows: (start: number, end: number) => Promise<ReadonlyMap<number, RowSize>>;
  readonly readColumns: (start: number, end: number) => Promise<ReadonlyMap<number, ColumnSize>>;
  readonly defaultRowHeight: number;
  readonly defaultColumnWidth: number;
}

const PT_PER_PX = 0.75;
/** Enough rounds for any real sheet; each one reads further than the last. */
const MAX_ROUNDS = 16;

const union = (left: Extent, right: Extent): Extent => ({ endRow: Math.max(left.endRow, right.endRow), endColumn: Math.max(left.endColumn, right.endColumn) });
const fits = (extent: Extent): boolean => (extent.endRow + 1) * (extent.endColumn + 1) <= MAX_PRINT_CELLS;

/** The last index whose start lies before `edge`: an edge exactly on a
 *  cell boundary does not reach into the next cell. */
function lastIndexBefore(offsets: XlsxPrintOffsets, edge: number, from: number): number {
  let index = Math.max(0, from);
  while (index < MAX_PRINT_CELLS && offsets.at(index + 1) < edge) index += 1;
  return index;
}

/** The last row and column the sheet's visuals cover, or null when none
 *  lies on it (or every one lies too far out to print). */
export async function drawnExtent(input: XlsxDrawnExtentInput): Promise<Extent | null> {
  const ids = new Set(input.sheetIds);
  // Anchors only: images are rendered lazily, so this listing draws nothing.
  const candidates = input.visuals(input.sheetIds[0], () => null).flatMap(({ sheetId, anchor }, index) => {
    const from = { endRow: anchor.fromRow, endColumn: anchor.fromColumn };
    const reach = union(from, { endRow: anchor.toRow, endColumn: anchor.toColumn });
    const finite = [reach.endRow, reach.endColumn].every((value) => Number.isInteger(value) && value >= 0);
    return ids.has(sheetId) && finite && fits(union(input.used, reach)) ? [{ index, from, reach }] : [];
  });
  if (candidates.length === 0) return null;

  const rows = new Map<number, RowSize>();
  const columns = new Map<number, ColumnSize>();
  let rowsRead = -1;
  let columnsRead = -1;
  const read = async (to: Extent) => {
    if (to.endRow > rowsRead) {
      for (const [row, size] of await input.readRows(rowsRead + 1, to.endRow)) rows.set(row, size);
      rowsRead = to.endRow;
    }
    if (to.endColumn > columnsRead) {
      for (const [column, size] of await input.readColumns(columnsRead + 1, to.endColumn)) columns.set(column, size);
      columnsRead = to.endColumn;
    }
  };
  const rowHeight = (row: number) => (rows.get(row)?.hidden ? 0 : (rows.get(row)?.height ?? input.defaultRowHeight));
  const columnWidth = (column: number) => (columns.get(column)?.hidden ? 0 : (columns.get(column)?.width ?? input.defaultColumnWidth));

  // Every box starts (and a two-cell one ends) inside the anchors' cells, so
  // once those are read the boxes are exact; only where they end needs more.
  await read(candidates.reduce((extent, candidate) => union(extent, candidate.reach), input.used));
  const metrics = { columnWidth: (column: number) => columnWidth(column) / PT_PER_PX, rowHeight: (row: number) => rowHeight(row) / PT_PER_PX };
  const measured = input.visuals(input.sheetIds[0], (sheetId) => (ids.has(sheetId) ? metrics : null));

  let drawn: Extent | null = null;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const rowOffsets = new XlsxPrintOffsets(rowHeight);
    const columnOffsets = new XlsxPrintOffsets(columnWidth);
    const ends = candidates.map(({ index, from, reach }) => {
      const box = measured[index]?.box;
      if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) return reach;
      return {
        endRow: lastIndexBefore(rowOffsets, (box.y + box.height) * PT_PER_PX, from.endRow),
        endColumn: lastIndexBefore(columnOffsets, (box.x + box.width) * PT_PER_PX, from.endColumn),
      };
    });
    // Nearest first, so one stray visual cannot keep the others out.
    drawn = null;
    let range = input.used;
    for (const end of [...ends].sort((left, right) => (left.endRow + 1) * (left.endColumn + 1) - (right.endRow + 1) * (right.endColumn + 1))) {
      if (!fits(union(range, end))) continue;
      range = union(range, end);
      drawn = drawn ? union(drawn, end) : end;
    }
    if (range.endRow <= rowsRead && range.endColumn <= columnsRead) break;
    // Rows/columns past what was read were measured at the default size; read
    // them and measure again (a hidden one moves the edge further out).
    await read(range);
  }
  return drawn;
}
