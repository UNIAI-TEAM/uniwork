// Excel's Data > Remove Duplicates, planned over the live values of the
// selection: rows whose compared columns repeat an earlier row are dropped,
// the kept rows move up inside the selection (columns outside it never move)
// and the freed rows at the bottom are emptied. The whole selection is
// rewritten by ONE set-range-values in one undo step. Values only: a range
// with formulas is refused (moving a formula would re-point its references),
// and cell formatting stays where it is.
import type { XlsxCellState } from "@uniwork/office-engine/xlsx";
import { isBlankCell, scalarCellData } from "./range-values";

export interface XlsxRemoveDuplicatesPlan {
  /** The rewritten rectangle, row-major, as Univer cell data. */
  readonly values: readonly (readonly Record<string, unknown>[])[];
  /** Data rows dropped as duplicates. */
  readonly removed: number;
  /** Data rows kept (unique). */
  readonly kept: number;
}

export type XlsxRemoveDuplicatesRefusal = "formulas" | "needRows" | "noColumns";

/** Excel compares values, text case-insensitively. */
function keyOf(cell: XlsxCellState | null): string {
  const value = cell?.value ?? null;
  if (value === null || value === "") return "e:";
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  return `s:${value.toLocaleLowerCase()}`;
}

export function planRemoveDuplicates(
  selected: readonly (readonly (XlsxCellState | null)[])[],
  options: { hasHeader: boolean; columns: readonly number[] },
): XlsxRemoveDuplicatesPlan | XlsxRemoveDuplicatesRefusal {
  // Excel works on the used range: the empty rows at the bottom of a
  // whole-column selection are not data, never "duplicates", and stay
  // untouched (review-design F4).
  let used = selected.length;
  while (used > 0 && (selected[used - 1] ?? []).every(isBlankCell)) used -= 1;
  const cells = selected.slice(0, used);
  if (cells.some((row) => row.some((cell) => cell?.formula))) return "formulas";
  if (options.columns.length === 0) return "noColumns";
  const header = options.hasHeader ? cells.slice(0, 1) : [];
  const data = options.hasHeader ? cells.slice(1) : cells;
  if (cells.length < 2) return "needRows";
  const seen = new Set<string>();
  const unique: (readonly (XlsxCellState | null)[])[] = [];
  for (const row of data) {
    const key = options.columns.map((column) => keyOf(row[column] ?? null)).join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  const width = cells[0]?.length ?? 0;
  const blank = Array.from({ length: width }, () => scalarCellData(null));
  const values = [
    ...[...header, ...unique].map((row) => row.map((cell) => scalarCellData(cell?.value))),
    ...Array.from({ length: data.length - unique.length }, () => blank),
  ];
  return { values, removed: data.length - unique.length, kept: unique.length };
}

/** The header text a column checkbox shows: the header cell when the data has
 *  headers and it is not empty, else null (the dialog says "Column X"). */
export function headerLabel(cells: readonly (readonly (XlsxCellState | null)[])[], column: number, hasHeader: boolean): string | null {
  if (!hasHeader) return null;
  const value = cells[0]?.[column]?.value ?? null;
  return value === null || value === "" ? null : String(value);
}
