// Envelope edits[] → typed XLSX ops. Each item is {op, target, text, style,
// attributes} per the contract's EDIT_FIELDS; the op vocabulary is this lane's
// (set_cell / clear_cell / set_cells). A malformed item is a typed XlsxOpError,
// never a silent drop — the caller's ops either all parse or the job fails
// before a byte is touched.
//
// FIX-926-B: the op families and the shared vocabulary now live in sibling
// modules (ops-shared.ts, ops-structure.ts, ops-filter.ts, ops-page-setup.ts,
// ops-sheets.ts) so each stays under the max-lines budget. This module keeps
// the registry + fold and re-exports the public names, so the module surface
// is unchanged.
import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import { XlsxOpError, isDict, str, parseSetCell, parseClearCell, parseSetCells } from "./ops-shared.ts";
import type { XlsxEditOp, XlsxOpKind, XlsxSheetResolver } from "./ops-shared.ts";
import { shiftParser, sizeParser, hiddenParser, outlineParser, mergeParser } from "./ops-structure.ts";
import { parseSetFilter, parseClearFilter } from "./ops-filter.ts";
import { parseSetPageSetup } from "./ops-page-setup.ts";
import { parseAddSheet, parseDuplicateSheet, parseRenameSheet, parseRemoveSheet, parseReorderSheet, parseSheetHidden } from "./ops-sheets.ts";
import { parseCreateTable, parseRemoveTable } from "./ops-tables.ts";
import { parseSetHyperlink } from "./ops-hyperlinks.ts";
import { parseSetNotes } from "./ops-notes.ts";
import { parseSetSheetProtection } from "./ops-protection.ts";
import { parseSetDefinedNames } from "./ops-names.ts";

export {
  XlsxOpError,
  isXlsxStructuralOp,
  isXlsxSheetOp,
  groupXlsxStructuralOps,
  isXlsxFilterOp,
  groupXlsxFilterStates,
  columnLettersToIndex,
  a1ToRowColumn,
  recalcInputFor,
  toA1,
} from "./ops-shared.ts";
export type {
  XlsxCellTarget,
  XlsxMergeArea,
  XlsxStructuralOp,
  XlsxFilterCustomCondition,
  XlsxFilterColumnState,
  XlsxFilterSetState,
  XlsxFilterOp,
  XlsxSheetFilterState,
  XlsxUpstreamStructuralOp,
  XlsxSheetStructuralOps,
  XlsxSheetOp,
  XlsxEditOp,
  XlsxOpKindSlot,
  XlsxOpKind,
  XlsxSheetResolver,
} from "./ops-shared.ts";
export type { XlsxHyperlinkOp, XlsxSheetHyperlinkEdits } from "./ops-hyperlinks.ts";
export { isXlsxHyperlinkOp, groupXlsxHyperlinkEdits, HYPERLINK_OP_KIND } from "./ops-hyperlinks.ts";
export type { XlsxNotesOp, XlsxSheetNote, XlsxSheetNoteState } from "./ops-notes.ts";
export { groupXlsxSheetProtectionStates, isXlsxSheetProtectionOp, SHEET_PROTECTION_OP_KIND } from "./ops-protection.ts";
export type { XlsxSheetProtectionOp, XlsxSheetProtectionState } from "./ops-protection.ts";
export { groupXlsxDefinedNamesState, isXlsxDefinedNamesOp, DEFINED_NAMES_OP_KIND } from "./ops-names.ts";
export type { XlsxDefinedNamesOp, XlsxDefinedNamesState, XlsxDefinedNameEntry } from "./ops-names.ts";
export { isXlsxNotesOp, groupXlsxNoteStates, NOTES_OP_KIND } from "./ops-notes.ts";

/** The bound wire vocabulary, in the order the unknown-op message lists it.
 *  A later op kind appends its entry here (with its typed op in XlsxEditOp
 *  and its slot named) — parseXlsxOps itself does not change. */
export const XLSX_OP_KINDS: readonly XlsxOpKind[] = [
  { wireName: "set_cell", slot: "cellEdits", parse: parseSetCell },
  { wireName: "clear_cell", slot: "cellEdits", parse: parseClearCell },
  { wireName: "set_cells", slot: "cellEdits", parse: parseSetCells },
  { wireName: "insert_rows", slot: "structuralOps", parse: shiftParser("insert_rows") },
  { wireName: "remove_rows", slot: "structuralOps", parse: shiftParser("remove_rows") },
  { wireName: "insert_cols", slot: "structuralOps", parse: shiftParser("insert_cols") },
  { wireName: "remove_cols", slot: "structuralOps", parse: shiftParser("remove_cols") },
  { wireName: "set_row_size", slot: "structuralOps", parse: sizeParser("set_row_size") },
  { wireName: "set_col_size", slot: "structuralOps", parse: sizeParser("set_col_size") },
  { wireName: "set_rows_hidden", slot: "structuralOps", parse: hiddenParser("set_rows_hidden") },
  { wireName: "set_cols_hidden", slot: "structuralOps", parse: hiddenParser("set_cols_hidden") },
  { wireName: "set_rows_outline", slot: "structuralOps", parse: outlineParser("set_rows_outline") },
  { wireName: "set_cols_outline", slot: "structuralOps", parse: outlineParser("set_cols_outline") },
  { wireName: "merge_cells", slot: "structuralOps", parse: mergeParser("merge_cells") },
  { wireName: "unmerge_cells", slot: "structuralOps", parse: mergeParser("unmerge_cells") },
  { wireName: "set_filter", slot: "filterStates", parse: parseSetFilter },
  { wireName: "clear_filter", slot: "filterStates", parse: parseClearFilter },
  { wireName: "set_page_setup", slot: "pageSetupStates", parse: parseSetPageSetup },
  { wireName: "add_sheet", slot: "sheetPlan", parse: parseAddSheet },
  { wireName: "duplicate_sheet", slot: "sheetPlan", parse: parseDuplicateSheet },
  { wireName: "rename_sheet", slot: "sheetPlan", parse: parseRenameSheet },
  { wireName: "remove_sheet", slot: "sheetPlan", parse: parseRemoveSheet },
  { wireName: "reorder_sheet", slot: "sheetPlan", parse: parseReorderSheet },
  { wireName: "set_sheet_hidden", slot: "sheetPlan", parse: parseSheetHidden },
  { wireName: "create_table", slot: "tableAdditions", parse: parseCreateTable },
  { wireName: "remove_table", slot: "tableAdditions", parse: parseRemoveTable },
  { wireName: "set_hyperlink", slot: "hyperlinkEdits", parse: parseSetHyperlink },
  { wireName: "set_notes", slot: "noteStates", parse: parseSetNotes },
  { wireName: "set_sheet_protection", slot: "sheetProtections", parse: parseSetSheetProtection },
  { wireName: "set_defined_names", slot: "definedNamesState", parse: parseSetDefinedNames },
];

const OP_KIND_BY_NAME: ReadonlyMap<string, XlsxOpKind> = new Map(XLSX_OP_KINDS.map((kind) => [kind.wireName, kind]));

/**
 * Fold a validated envelope edits array into typed ops through the op-kind
 * registry. Unknown op names are a typed error (unsupported): the caller
 * learns the vocabulary is narrower than upstream's full sheet-op set, not
 * that its op vanished.
 *
 * `onOp` is the emission-order seam: when supplied, each op is handed over as
 * it is produced, BEFORE the next item parses. The session model uses it to
 * apply sheet ops while parsing — a later op's `target.sheet` must resolve
 * against a rename that an earlier op just applied (live resolver), and the
 * alternative (parse everything, then apply everything) cannot see it.
 */
export function parseXlsxOps(
  edits: unknown[],
  sheets: XlsxSheetResolver,
  onOp?: (op: XlsxEditOp) => void,
): XlsxEditOp[] {
  if (edits.length > ENGINE_LIMITS.max_edit_ops) {
    throw new XlsxOpError("<edits>", "", `at most ${ENGINE_LIMITS.max_edit_ops} ops per job`);
  }
  const ops: XlsxEditOp[] = [];
  for (const item of edits) {
    if (!isDict(item)) throw new XlsxOpError("<item>", "", "object required");
    const op = str(item.op, "<item>", "op");
    const kind = OP_KIND_BY_NAME.get(op);
    if (!kind) {
      const bound = XLSX_OP_KINDS.map((entry) => entry.wireName).join(", ");
      throw new XlsxOpError(op, "", `unknown op for xlsx (bound: ${bound})`, true);
    }
    for (const parsed of kind.parse(item, op, sheets)) {
      ops.push(parsed);
      onOp?.(parsed);
    }
  }
  return ops;
}

