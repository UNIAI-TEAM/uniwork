// B3 (UNI-924): the notes command area. The controller in
// ../notes/docx-notes-controller.ts owns the lists + reference markers; this
// file only publishes it on the shared command runtime, so the toolbar group,
// the notes pane and the save snapshot reach it without touching the editor.
import type { DocxNoteInfo, DocxNoteKind } from "@uniwork/office-engine/docx";
import { createDocxNotesController, type DocxNotesController, type DocxNotesSnapshot } from "../notes/docx-notes-controller";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxNotesSnapshot } from "../notes/docx-notes-controller";

export interface DocxNotesFormatState {
  /** The authoritative note lists (empty until a document is open). */
  docxNotes: { footnotes: DocxNoteInfo[]; endnotes: DocxNoteInfo[] };
}

export interface DocxNotesCommands {
  /** Open/restore hook: seed the parse's own note parts. */
  seedDocxNotes(footnotes: DocxNoteInfo[], endnotes: DocxNoteInfo[]): void;
  listDocxNotes(): { footnotes: DocxNoteInfo[]; endnotes: DocxNoteInfo[] };
  canInsertDocxNote(): boolean;
  insertDocxNote(kind: DocxNoteKind, text: string): DocxNoteInfo | null;
  setDocxNoteText(kind: DocxNoteKind, id: string, text: string): boolean;
  deleteDocxNote(kind: DocxNoteKind, id: string): boolean;
  hasDocxNoteRef(kind: DocxNoteKind, id: string): boolean;
  jumpToDocxNote(kind: DocxNoteKind, id: string): boolean;
  /** Save payload: full lists + the kinds the user edited (only an edited kind
   * reaches the save options, so an untouched part stays byte-identical). */
  snapshotDocxNotes(): DocxNotesSnapshot;
  /** Draft restore: re-seed the lists and their edit flags. */
  restoreDocxNotes(snapshot: DocxNotesSnapshot): void;
}

export function createNotesCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxNotesCommands, DocxNotesFormatState> {
  const controller: DocxNotesController = createDocxNotesController(() => context.getEditor());
  const listAll = () => ({ footnotes: controller.list("footnote"), endnotes: controller.list("endnote") });
  return {
    commands: {
      seedDocxNotes: (footnotes, endnotes) => controller.seed(footnotes, endnotes),
      listDocxNotes: listAll,
      canInsertDocxNote: () => controller.canInsert(),
      insertDocxNote: (kind, text) => controller.insert(kind, text),
      setDocxNoteText: (kind, id, text) => controller.setText(kind, id, text),
      deleteDocxNote: (kind, id) => controller.remove(kind, id),
      hasDocxNoteRef: (kind, id) => controller.hasRef(kind, id),
      jumpToDocxNote: (kind, id) => controller.jump(kind, id),
      snapshotDocxNotes: () => controller.snapshot(),
      restoreDocxNotes: (snapshot) => controller.restore(snapshot),
    },
    readState: () => ({ docxNotes: listAll() }),
  };
}
