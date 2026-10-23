// XLSX note/comment op parser (noteStates slot). The shared vocabulary lives
// in ops-shared.ts. Split out so ops.ts stays under the max-lines budget.
//
// Wire shape: { op: "set_notes", target: { sheet }, attributes: { notes: [ {
// row, column, author, text } ] } }. Notes are a whole-sheet DECLARATIVE
// snapshot: the gateway's applySheetNotes replaces the worksheet's complete
// comment set (an empty list removes every note), so the model folds the last
// op per sheet. Coordinates are 0-based and final at emission time (the
// renderer re-snapshots after any structural shift), and the gateway applies
// noteStates after the worksheet flush.
import {
  XlsxOpError,
  isDict,
  int,
  str,
  parseStructuralTarget,
  parseStructuralAttributes,
  MAX_ROWS,
  MAX_COLS,
  type Dict,
  type XlsxEditOp,
  type XlsxSheetResolver,
} from "./ops-shared.ts";

/** The vendored wire schema's bounds (desktop-api.ts workbookNoteStateSchema):
 *  at most 1000 notes per sheet, author <=255 chars, text <=32767 chars. */
const MAX_NOTES = 1_000;
const MAX_NOTE_AUTHOR_LEN = 255;
const MAX_NOTE_TEXT_LEN = 32_767;

export const NOTES_OP_KIND = "set_notes";

/** One note (the gateway's SheetNote, xlsx-notes.ts). */
export interface XlsxSheetNote {
  readonly row: number;
  readonly column: number;
  readonly author: string;
  readonly text: string;
}

/** One declarative whole-sheet note snapshot (the typed op). */
export type XlsxNotesOp = {
  readonly kind: "set_notes";
  readonly sheetName: string;
  readonly notes: readonly XlsxSheetNote[];
};

/** The gateway's SheetNoteState: the sheet name plus its complete note set. */
export interface XlsxSheetNoteState {
  readonly sheetName: string;
  readonly notes: readonly XlsxSheetNote[];
}

export function isXlsxNotesOp(op: XlsxEditOp): op is XlsxNotesOp {
  return op.kind === NOTES_OP_KIND;
}

function parseNote(raw: unknown, op: string): XlsxSheetNote {
  if (!isDict(raw)) throw new XlsxOpError(op, "attributes.notes", "note objects required");
  const row = int(raw.row, op, "attributes.notes.row");
  const column = int(raw.column, op, "attributes.notes.column");
  if (row < 0 || row >= MAX_ROWS || column < 0 || column >= MAX_COLS) {
    throw new XlsxOpError(op, "attributes.notes", "note cell outside the OOXML grid");
  }
  const author = str(raw.author, op, "attributes.notes.author");
  if (author.length > MAX_NOTE_AUTHOR_LEN) throw new XlsxOpError(op, "attributes.notes.author", "author too long");
  const text = str(raw.text, op, "attributes.notes.text");
  if (text.length > MAX_NOTE_TEXT_LEN) throw new XlsxOpError(op, "attributes.notes.text", "note text exceeds the bound");
  return { row, column, author, text };
}

export function parseSetNotes(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  if (!Array.isArray(a.notes) || a.notes.length > MAX_NOTES) {
    throw new XlsxOpError(op, "attributes.notes", `at most ${MAX_NOTES} notes required`);
  }
  const notes = a.notes.map((note) => parseNote(note, op));
  const seen = new Set<string>();
  for (const note of notes) {
    const key = `${note.row}:${note.column}`;
    if (seen.has(key)) throw new XlsxOpError(op, "attributes.notes", "one note per cell");
    seen.add(key);
  }
  return [{ kind: NOTES_OP_KIND, sheetName, notes }];
}

/** Fold note snapshots per sheet, last write wins, in first-touch sheet
 *  order. The snapshot is whole-sheet, so only the last op matters; an empty
 *  list removes the sheet's comment set. */
export function groupXlsxNoteStates(ops: readonly XlsxEditOp[]): XlsxSheetNoteState[] {
  const bySheet = new Map<string, XlsxSheetNoteState>();
  for (const op of ops) {
    if (!isXlsxNotesOp(op)) continue;
    bySheet.set(op.sheetName, { sheetName: op.sheetName, notes: op.notes });
  }
  return [...bySheet.values()];
}
