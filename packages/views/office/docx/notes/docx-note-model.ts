// Footnote/endnote rules for the DOCX notes pane — pure helpers only, so the
// controller (notes/docx-notes-controller.ts) owns every state change and the
// panel renders what it is told. Word semantics: notes number by part order,
// so deleting one renumbers the survivors; there is no thread graph like
// comments, only the list plus each note's inline reference marker.
import type { DocxNoteInfo } from "@uniwork/office-engine/docx";

/** Smallest unused numeric note id — Word-compatible numeric ids (mirrors the
 * upstream nextNoteId contract, docx-engine/src/notes.ts:342). */
export function nextNoteId(notes: readonly DocxNoteInfo[]): string {
  const max = notes.reduce((acc, note) => Math.max(acc, Number.parseInt(note.id, 10) || 0), 0);
  return String(max + 1);
}

/** Display number of a note: its 1-based position in the part (0 = absent). */
export function noteNumberOf(notes: readonly DocxNoteInfo[], id: string): number {
  return notes.findIndex((note) => note.id === id) + 1;
}

/** A plain-text edit drops the measured rich runs: a kept `richParas` would
 * win over the edited text when the vendored save has to rebuild the entry
 * (docx-engine/src/notes.ts:265), silently reverting the edit. */
export function editedNote(note: DocxNoteInfo, text: string): DocxNoteInfo {
  const next: DocxNoteInfo = { ...note, text };
  delete next.richParas;
  return next;
}

/** Display numbers per note id, in part order. Used to renumber the in-text
 * markers after a delete. */
export function noteNumbers(notes: readonly DocxNoteInfo[]): Map<string, number> {
  return new Map(notes.map((note, index) => [note.id, index + 1]));
}
