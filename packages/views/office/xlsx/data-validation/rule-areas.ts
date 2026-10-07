// Shared helpers of the rule managers (conditional formats and data
// validation): A1 labels of a rule's areas and the "This selection" filter.

import { columnLabel } from "../xlsx-editor-model";
import type { XlsxToolbarTableRange } from "../toolbar/types";

/** The A1 label of a rectangle ("A1:C4", or "B2" for one cell). */
export function rangeLabel(range: XlsxToolbarTableRange): string {
  const start = `${columnLabel(range.startColumn)}${range.startRow + 1}`;
  const end = `${columnLabel(range.endColumn)}${range.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

export function rangesLabel(ranges: readonly XlsxToolbarTableRange[]): string {
  return ranges.map(rangeLabel).join(", ");
}

function intersects(a: XlsxToolbarTableRange, b: XlsxToolbarTableRange): boolean {
  return a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn;
}

/** True when any area of the rule overlaps the selection. */
export function areasTouch(ranges: readonly XlsxToolbarTableRange[], selection: XlsxToolbarTableRange): boolean {
  return ranges.some((range) => intersects(range, selection));
}
