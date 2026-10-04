// B7 (UNI-926): the pure form model for the protect + name-manager dialog.
// The dialog edits a list of defined names; this module maps the rows to the
// engine's XlsxDefinedNameEntry list and validates each name with the same
// grammar the engine parser and the Go validator use, so an invalid row is
// refused in the dialog with a localized message instead of a raw op error.
import type { XlsxDefinedNameEntry } from "@uniwork/office-engine/xlsx";

export interface XlsxNameRow {
  name: string;
  formula: string;
  /** Empty = workbook scope; otherwise the 0-based sheet index. */
  sheetIndex: string;
}

export function emptyNameRow(): XlsxNameRow {
  return { name: "", formula: "", sheetIndex: "" };
}

// Excel name grammar, mirroring xlsx-defined-names.ts validateName and the Go
// officeDefinedNameOK: a letter/_/backslash, then letters/digits/_/./backslash,
// at most 255 chars, never an A1/R1C1 cell ref, TRUE/FALSE, or _xlnm built-in.
const NAME_PATTERN = /^[\p{L}_\\][\p{L}\p{N}_.\\]*$/u;
const CELL_REF_PATTERN = /^(?:[A-Za-z]{1,3}[0-9]+|[Rr][0-9]*[Cc][0-9]*)$/;

export function definedNameValid(name: string): boolean {
  if (name.length === 0 || name.length > 255 || !NAME_PATTERN.test(name)) return false;
  if (CELL_REF_PATTERN.test(name)) return false;
  const lower = name.toLowerCase();
  return lower !== "true" && lower !== "false" && !name.startsWith("_xlnm");
}

export type XlsxNamesBuild =
  | { readonly ok: true; readonly names: XlsxDefinedNameEntry[] }
  | { readonly ok: false; readonly error: "name" | "formula" | "sheetIndex" | "duplicate" };

export function buildDefinedNames(rows: readonly XlsxNameRow[]): XlsxNamesBuild {
  const names: XlsxDefinedNameEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    const formula = row.formula.trim();
    if (name === "" && formula === "") continue; // a blank row is ignored
    if (!definedNameValid(name)) return { ok: false, error: "name" };
    if (formula === "") return { ok: false, error: "formula" };
    let sheetIndex: number | undefined;
    const rawIndex = row.sheetIndex.trim();
    if (rawIndex !== "") {
      if (!/^\d+$/.test(rawIndex)) return { ok: false, error: "sheetIndex" };
      sheetIndex = Number.parseInt(rawIndex, 10);
      if (sheetIndex > 16_383) return { ok: false, error: "sheetIndex" };
    }
    const key = name + "\u0000" + (sheetIndex ?? -1);
    if (seen.has(key)) return { ok: false, error: "duplicate" };
    seen.add(key);
    names.push({ name, formula, ...(sheetIndex === undefined ? {} : { sheetIndex }) });
  }
  return { ok: true, names };
}
