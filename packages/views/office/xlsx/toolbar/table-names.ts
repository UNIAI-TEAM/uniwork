// Table-name rules for the Insert > Tables field. Mirrors the gateway grammar
// (office-engine ops-tables.ts / the renderer command policy) so a name the
// field accepts is one the save path accepts, and proposes the next free
// "TableN" across the whole workbook (the renderer alone only counts the
// tables created this session, so it could collide with a file-native table).
import type { XlsxToolbarTable } from "./types";

const TABLE_NAME = /^[A-Za-z_\\][A-Za-z0-9_.]{0,254}$/;
const CELL_REF = /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*$/;

export function isValidTableName(name: string): boolean {
  return TABLE_NAME.test(name) && !CELL_REF.test(name);
}

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
