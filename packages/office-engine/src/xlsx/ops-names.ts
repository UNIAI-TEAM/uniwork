// XLSX defined-names op parser + fold (definedNamesState slot). A sibling of
// the other op-family modules (ops-structure / ops-filter / ops-page-setup).
//
// Wire shape: { op: "set_defined_names", attributes: { names, preserveNames } }.
// No target: the vendored gateway's applyDefinedNamesState rewrites
// workbook.xml's <definedNames> from the editor's model wholesale, so the state
// is workbook-scoped. Entries the editor never models (_xlnm.* built-ins,
// hidden names, and names it failed to install) stay byte-verbatim; that set
// rides `preserveNames`. Only one snapshot matters per save, so the fold keeps
// the LAST set_defined_names op in emission order.
import { XlsxOpError, isDict, int, parseStructuralAttributes, type Dict, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";

/** One defined-name entry (upstream DefinedNameEntry, xlsx-defined-names.ts):
 *  `sheetIndex` is the 0-based position in workbook sheet order for a
 *  sheet-scoped name; absent means workbook scope. */
export interface XlsxDefinedNameEntry {
  readonly name: string;
  readonly formula: string;
  readonly sheetIndex?: number | undefined;
}

/** The gateway's DefinedNamesState (xlsx-defined-names.ts) - the shape of the
 *  `definedNamesState` argument. `preserveNames` lists names that already exist
 *  in a form the editor cannot model, so the writer keeps them verbatim and a
 *  duplicate is refused. */
export interface XlsxDefinedNamesState {
  readonly names: readonly XlsxDefinedNameEntry[];
  readonly preserveNames: readonly string[];
}

/** The envelope op (definedNamesState slot): the whole declarative snapshot. */
export type XlsxDefinedNamesOp = {
  readonly kind: "set_defined_names";
  readonly state: XlsxDefinedNamesState;
};

export const DEFINED_NAMES_OP_KIND = "set_defined_names";

/** Excel name rules, mirroring the vendored validateName (xlsx-defined-names.ts):
 *  starts with a letter, `_` or `\`; continues with letters, digits, `_`, `.`
 *  or `\`; at most 255 chars; never an A1/R1C1 cell reference, TRUE/FALSE, or
 *  an `_xlnm` built-in. Letters are Unicode (Excel accepts CJK names). */
const NAME_PATTERN = /^[\p{L}_\\][\p{L}\p{N}_.\\]*$/u;
const CELL_REF_PATTERN = /^(?:[A-Za-z]{1,3}[0-9]+|[Rr][0-9]*[Cc][0-9]*)$/;
const MAX_NAME_LEN = 255;
const MAX_DEFINED_NAMES = 10_000;

function definedNameOK(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LEN || !NAME_PATTERN.test(name)) return false;
  if (CELL_REF_PATTERN.test(name)) return false;
  const lower = name.toLowerCase();
  if (lower === "true" || lower === "false" || name.startsWith("_xlnm")) return false;
  return true;
}

export function isXlsxDefinedNamesOp(op: XlsxEditOp): op is XlsxDefinedNamesOp {
  return op.kind === DEFINED_NAMES_OP_KIND;
}

/** Fold defined-names ops: the LAST snapshot wins (workbook-scoped, so there is
 *  no per-sheet merge). Undefined when the session has no defined-names edit. */
export function groupXlsxDefinedNamesState(ops: readonly XlsxEditOp[]): XlsxDefinedNamesState | undefined {
  let state: XlsxDefinedNamesState | undefined;
  for (const op of ops) {
    if (!isXlsxDefinedNamesOp(op)) continue;
    state = op.state;
  }
  return state;
}

function parseDefinedNameEntry(raw: unknown, op: string, seen: Set<string>): XlsxDefinedNameEntry {
  if (!isDict(raw)) throw new XlsxOpError(op, "attributes.names", "name objects required");
  const name = raw.name;
  if (typeof name !== "string" || !definedNameOK(name)) {
    throw new XlsxOpError(op, "attributes.names.name", "a valid Excel defined name is required");
  }
  const formula = raw.formula;
  if (typeof formula !== "string" || formula.length === 0) {
    throw new XlsxOpError(op, "attributes.names.formula", "a non-empty formula is required");
  }
  let sheetIndex: number | undefined;
  if (raw.sheetIndex !== undefined) {
    const value = int(raw.sheetIndex, op, "attributes.names.sheetIndex");
    if (value < 0 || value >= 16_384) throw new XlsxOpError(op, "attributes.names.sheetIndex", "sheet index outside the workbook grid");
    sheetIndex = value;
  }
  const key = name + "\u0000" + (sheetIndex ?? -1);
  if (seen.has(key)) throw new XlsxOpError(op, "attributes.names", "the same name is defined twice for one scope");
  seen.add(key);
  return { name, formula, ...(sheetIndex === undefined ? {} : { sheetIndex }) };
}

export function parseSetDefinedNames(item: Dict, op: string, _sheets: XlsxSheetResolver): XlsxEditOp[] {
  const a = parseStructuralAttributes(item, op);
  for (const key of Object.keys(a)) {
    if (key !== "names" && key !== "preserveNames") throw new XlsxOpError(op, "attributes." + key, "unknown defined-names field");
  }
  if (!Array.isArray(a.names) || a.names.length > MAX_DEFINED_NAMES) {
    throw new XlsxOpError(op, "attributes.names", "at most " + MAX_DEFINED_NAMES + " names");
  }
  const seen = new Set<string>();
  const names = a.names.map((entry) => parseDefinedNameEntry(entry, op, seen));
  if (a.preserveNames !== undefined) {
    if (!Array.isArray(a.preserveNames) || a.preserveNames.length > MAX_DEFINED_NAMES) {
      throw new XlsxOpError(op, "attributes.preserveNames", "at most " + MAX_DEFINED_NAMES + " preserved names");
    }
  }
  const preserveNames = (a.preserveNames ?? []).map((entry) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_NAME_LEN) {
      throw new XlsxOpError(op, "attributes.preserveNames", "name strings are bounded");
    }
    return entry;
  });
  const preserved = new Set(preserveNames);
  for (const entry of names) {
    if (preserved.has(entry.name)) {
      throw new XlsxOpError(op, "attributes.names", "a name cannot be both modeled and preserved");
    }
  }
  return [{ kind: DEFINED_NAMES_OP_KIND, state: { names, preserveNames } }];
}
