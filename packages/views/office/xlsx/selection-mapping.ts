import type { XlsxSelection } from "./types";
import { toA1Address } from "./xlsx-render-model-bridge";

/** Univer's RANGE_TYPE (`@univerjs/core` typedef): what a grid selection
 *  covers. ROW = whole rows, COLUMN = whole columns, ALL = the whole sheet. */
export const XLSX_RANGE_TYPE = { NORMAL: 0, ROW: 1, COLUMN: 2, ALL: 3 } as const;

export type XlsxRangeType = (typeof XLSX_RANGE_TYPE)[keyof typeof XLSX_RANGE_TYPE];

export interface XlsxGridRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  rangeType?: number;
  /** The renderer found this range to be exactly one merged cell. */
  merged?: boolean;
}

function knownRangeType(value: number | undefined): value is XlsxRangeType {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** The workbook selection for a renderer range: A1 corners, plus the range
 *  type so whole-row/column selections are told apart from wide ranges. */
export function xlsxSelectionFromGrid(sheet: string, range: XlsxGridRange): XlsxSelection {
  const single = range.startRow === range.endRow && range.startColumn === range.endColumn;
  return {
    sheet,
    address: toA1Address(range.startRow, range.startColumn),
    ...(single ? {} : { endAddress: toA1Address(range.endRow, range.endColumn) }),
    ...(knownRangeType(range.rangeType) ? { rangeType: range.rangeType } : {}),
    ...(range.merged === true ? { merged: true as const } : {}),
  };
}
