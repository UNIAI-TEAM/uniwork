// Table names for Insert > Table and Home > Format as Table: the next free
// "TableN" across the whole workbook (the renderer alone only counts the
// tables created this session, so it could collide with a file-native table).
import type { XlsxToolbarTable } from "./types";

export function tableNameTaken(tables: readonly XlsxToolbarTable[] | undefined, name: string): boolean {
  const needle = name.toLowerCase();
  return (tables ?? []).some((table) => table.name.toLowerCase() === needle);
}

/** The next unused "TableN" (N from 1) over every sheet's tables. */
export function nextTableName(tables: readonly XlsxToolbarTable[] | undefined): string {
  let index = 1;
  while (tableNameTaken(tables, `Table${index}`)) index += 1;
  return `Table${index}`;
}
