// Footnote/endnote rules for the DOCX notes pane — pure helpers only, so the
// controller (notes/docx-notes-controller.ts) owns every state change and the
// panel renders what it is told. Word semantics: a note's display number comes
// from its first body reference, so inserting or deleting a reference renumbers
// the later markers; there is no thread graph like comments, only the list plus
// each note's inline reference marker.
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

/** Display numbers per note id, mirroring the vendored parse rule
 * (`noteNumbersOf`, docx-engine/src/parse.ts:5597): every note starts at its
 * part-order slot, then body-reference order wins — a note takes its number at
 * its first reference (offset by `numStart`) and later references reuse it,
 * while references to a missing note are not counted. Notes never referenced
 * keep their part-order slot. */
export function noteNumbersOf(
  refIds: readonly string[],
  notes: readonly DocxNoteInfo[],
  numStart = 1,
): Map<string, number> {
  const out = new Map(notes.map((note, index) => [note.id, index + 1]));
  const numbered = new Set<string>();
  let count = 0;
  for (const id of refIds) {
    if (!out.has(id) || numbered.has(id)) continue;
    numbered.add(id);
    out.set(id, numStart + count);
    count += 1;
  }
  return out;
}
