// Pure logic of Data > Text to Columns (delimited mode): split each cell's
// text of one column at the chosen delimiters (Excel semantics, `"` as the
// text qualifier) and write the pieces right of it as ONE set-range-values.
import type { XlsxCellState } from "@uniwork/office-engine/xlsx";
import { pasteCellData } from "../../xlsx-clipboard-paste";
import type { XlsxToolbarCommandStep } from "../types";
import { isBlankCell, writeValuesStep } from "./range-values";

export interface TextToColumnsOptions {
  readonly tab: boolean;
  readonly semicolon: boolean;
  readonly comma: boolean;
  readonly space: boolean;
  /** One custom delimiter character; "" = none. */
  readonly other: string;
  /** Treat runs of delimiters as one. */
  readonly consecutive: boolean;
}

export interface TextToColumnsPlan {
  /** Pieces per source row (empty for a blank source cell). */
  readonly rows: readonly (readonly string[])[];
  /** The widest row: the columns written, the source column included. */
  readonly width: number;
  /** A destination cell right of the source column that will be written holds data. */
  readonly overwrite: boolean;
}

function delimiterSet(options: TextToColumnsOptions): Set<string> {
  const set = new Set<string>();
  if (options.tab) set.add("\t");
  if (options.semicolon) set.add(";");
  if (options.comma) set.add(",");
  if (options.space) set.add(" ");
  const other = Array.from(options.other)[0];
  if (other) set.add(other);
  return set;
}

export function hasDelimiter(options: TextToColumnsOptions): boolean {
  return delimiterSet(options).size > 0;
}

/** Splits `text`; a field that starts with `"` runs to the closing `"` (`""`
 *  is a literal quote) and may hold delimiters. No delimiter = one piece. */
export function splitText(text: string, options: TextToColumnsOptions): string[] {
  const delimiters = delimiterSet(options);
  if (text === "") return [];
  if (delimiters.size === 0) return [text];
  const pieces: string[] = [];
  let index = 0;
  const length = text.length;
  for (;;) {
    let piece = "";
    if (text[index] === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < length) {
        if (text[cursor] === '"') {
          if (text[cursor + 1] === '"') { piece += '"'; cursor += 2; continue; }
          closed = true;
          cursor += 1;
          break;
        }
        piece += text[cursor];
        cursor += 1;
      }
      if (!closed) { piece = text.slice(index); cursor = length; }
      // Text after the closing quote up to the delimiter stays in the field.
      while (cursor < length && !delimiters.has(text[cursor] as string)) { piece += text[cursor]; cursor += 1; }
      index = cursor;
    } else {
      let cursor = index;
      while (cursor < length && !delimiters.has(text[cursor] as string)) cursor += 1;
      piece = text.slice(index, cursor);
      index = cursor;
    }
    pieces.push(piece);
    if (index >= length) break;
    index += 1; // the delimiter
    if (options.consecutive) while (index < length && delimiters.has(text[index] as string)) index += 1;
    if (index >= length) { pieces.push(""); break; }
  }
  return pieces;
}

/** The text a cell splits: its value as a string ("" for none). */
export function cellSourceText(cell: XlsxCellState | null): string {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "boolean") return cell.value ? "TRUE" : "FALSE";
  return String(cell.value);
}

/** `cells`: the single source column, row-major. `right`: the cells of the
 *  columns right of it over the same rows (column start+1 first), to detect
 *  data about to be replaced. Trailing blank source rows are not part of the
 *  plan (a whole-column selection splits the used part only). */
export function planTextToColumns(
  cells: readonly (readonly (XlsxCellState | null)[])[],
  options: TextToColumnsOptions,
  right?: readonly (readonly (XlsxCellState | null)[])[],
): TextToColumnsPlan {
  let last = cells.length;
  while (last > 0 && isBlankCell(cells[last - 1]?.[0] ?? null)) last -= 1;
  const rows = cells.slice(0, last).map((row) => splitText(cellSourceText(row[0] ?? null), options));
  const width = rows.reduce((max, pieces) => Math.max(max, pieces.length), 0);
  const overwrite = rows.some((pieces, rowIndex) => {
    for (let k = 1; k < pieces.length; k += 1) {
      if (!isBlankCell(right?.[rowIndex]?.[k - 1] ?? null)) return true;
    }
    return false;
  });
  return { rows, width, overwrite };
}

/** One set-range-values over rows x width at the source column. A row with
 *  fewer pieces than `width` writes `{}` for the rest: the pinned
 *  SetRangeValuesMutation merges `{}` into the old cell, i.e. leaves it. */
export function textToColumnsStep(
  unitId: string,
  sheetId: string,
  span: { readonly startRow: number; readonly startColumn: number },
  pieces: readonly (readonly string[])[],
  width: number,
): XlsxToolbarCommandStep {
  const values = pieces.map((row) =>
    Array.from({ length: Math.max(width, 1) }, (_, column): Record<string, unknown> =>
      column < row.length ? pasteCellData(row[column] as string, null) : {},
    ),
  );
  return writeValuesStep(unitId, sheetId, span.startRow, span.startColumn, values);
}
