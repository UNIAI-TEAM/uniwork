// B7 (UNI-926): the pure form model for the protect + name-manager dialog.
// The dialog edits a list of defined names; this module maps the rows to the
// engine's XlsxDefinedNameEntry list and validates each name with the same
// grammar the engine parser and the Go validator use, so an invalid row is
// refused in the dialog with a localized message instead of a raw op error.
import type { XlsxDefinedNameEntry, XlsxRenderDefinedName } from "@uniwork/office-engine/xlsx";

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

/** The dialog's starting state for one workbook: the rows the form can model
 *  and the names it cannot (they must ride `preserveNames`, or a wholesale
 *  `set_defined_names` rewrite would delete them). */
export interface XlsxNamesSeed {
  readonly rows: XlsxNameRow[];
  readonly preserveNames: string[];
}

/**
 * Seed the name-manager rows from the workbook's own <definedNames>. A name is
 * modelable only when the form can represent it: not hidden, valid grammar,
 * a non-empty formula, and a scope inside the live sheet count. Everything
 * else - plus `_xlnm` built-ins the gateway already keeps - goes to
 * `preserveNames` (built-ins are skipped entirely; the gateway keeps them
 * whether or not they are listed).
 */
export function seedDefinedNames(
  definedNames: readonly XlsxRenderDefinedName[],
  sheetCount: number,
): XlsxNamesSeed {
  const rows: XlsxNameRow[] = [];
  const preserveNames: string[] = [];
  const seen = new Set<string>();
  for (const defined of definedNames) {
    // _xlnm.* built-ins are kept by the gateway unconditionally.
    if (defined.name.startsWith("_xlnm")) continue;
    const scopeOK = defined.sheetIndex === undefined ||
      (Number.isInteger(defined.sheetIndex) && defined.sheetIndex >= 0 && defined.sheetIndex < sheetCount);
    const modelable = !defined.hidden && definedNameValid(defined.name) && defined.formula.trim() !== "" && scopeOK;
    const key = defined.name + "\u0000" + (defined.sheetIndex ?? -1);
    if (!modelable || seen.has(key)) {
      if (!preserveNames.includes(defined.name)) preserveNames.push(defined.name);
      continue;
    }
    seen.add(key);
    rows.push({
      name: defined.name,
      formula: defined.formula,
      sheetIndex: defined.sheetIndex === undefined ? "" : String(defined.sheetIndex),
    });
  }
  return { rows, preserveNames };
}

export type XlsxNamesBuild =
  | { readonly ok: true; readonly names: XlsxDefinedNameEntry[] }
  | { readonly ok: false; readonly error: "name" | "formula" | "sheetIndex" | "duplicate" };

export function buildDefinedNames(rows: readonly XlsxNameRow[], sheetCount?: number): XlsxNamesBuild {
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
      // F5: bind the scope to the live sheet list when the caller knows it, so
      // an index can never point past the sheet count.
      if (sheetCount !== undefined && sheetCount > 0 && sheetIndex >= sheetCount) return { ok: false, error: "sheetIndex" };
    }
    const key = name + "\u0000" + (sheetIndex ?? -1);
    if (seen.has(key)) return { ok: false, error: "duplicate" };
    seen.add(key);
    names.push({ name, formula, ...(sheetIndex === undefined ? {} : { sheetIndex }) });
  }
  return { ok: true, names };
}
