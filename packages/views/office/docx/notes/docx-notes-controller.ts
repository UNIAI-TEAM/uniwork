// The note state machine over one live TipTap editor: the authoritative
// footnote/endnote lists (seeded from the open parse's parts) plus every
// reference mutation. Mirrors the upstream review-actions note paths
// (review-actions.ts:62-107), adapted to the UniWork command seam so the pane
// never touches the editor directly.
import type { Editor } from "@tiptap/core";
import type { DocxNoteInfo, DocxNoteKind } from "@uniwork/office-engine/docx";
import { editedNote, nextNoteId, noteNumbers } from "./docx-note-model";
import { hasNoteRef, insertNoteRef, jumpToNoteRef, removeNoteRefs, renumberNoteRefs } from "./docx-note-refs";

/** The lists plus the per-kind edit flags: only an edited kind reaches the
 * save options, so an untouched notes part stays byte-identical. */
export interface DocxNotesSnapshot {
  footnotes: DocxNoteInfo[];
  endnotes: DocxNoteInfo[];
  edited: { footnote: boolean; endnote: boolean };
}

/** The controller surface the command factory publishes. */
export interface DocxNotesController {
  /** Replace both lists (open/rebase: the parse's own parts) and clear flags. */
  seed(footnotes: DocxNoteInfo[], endnotes: DocxNoteInfo[]): void;
  list(kind: DocxNoteKind): DocxNoteInfo[];
  /** True while an editable document can take a new marker at the caret. */
  canInsert(): boolean;
  /** New note + marker at the caret; null without an editable editor or text. */
  insert(kind: DocxNoteKind, text: string): DocxNoteInfo | null;
  /** Edit a note's text; false for a blank body or an unknown id. */
  setText(kind: DocxNoteKind, id: string, text: string): boolean;
  /** Delete a note and its markers; the survivors renumber in the document. */
  remove(kind: DocxNoteKind, id: string): boolean;
  hasRef(kind: DocxNoteKind, id: string): boolean;
  /** Scroll to the marker and select it; false when it is gone. */
  jump(kind: DocxNoteKind, id: string): boolean;
  /** The save payload: full lists + the kinds the user actually edited. */
  snapshot(): DocxNotesSnapshot;
  /** Draft restore: re-seed the lists and their edit flags. */
  restore(snapshot: DocxNotesSnapshot): void;
}

export function createDocxNotesController(getEditor: () => Editor | null): DocxNotesController {
  const lists: Record<DocxNoteKind, DocxNoteInfo[]> = { footnote: [], endnote: [] };
  const edited: Record<DocxNoteKind, boolean> = { footnote: false, endnote: false };

  /** Force a state re-read after a list-only mutation: an empty transaction
   * runs TipTap's own onTransaction -> emitState cycle while docChanged stays
   * false, so the save generation does not move (same as the comments pane). */
  const touch = (editor: Editor) => {
    editor.view.dispatch(editor.state.tr);
  };

  const editable = (): Editor | null => {
    const editor = getEditor();
    return editor !== null && !editor.isDestroyed && editor.isEditable ? editor : null;
  };

  const copyLists = () => ({
    footnotes: lists.footnote.map((note) => ({ ...note })),
    endnotes: lists.endnote.map((note) => ({ ...note })),
  });

  return {
    seed: (footnotes, endnotes) => {
      lists.footnote = footnotes.map((note) => ({ ...note }));
      lists.endnote = endnotes.map((note) => ({ ...note }));
      edited.footnote = false;
      edited.endnote = false;
    },
    list: (kind) => lists[kind].map((note) => ({ ...note })),
    canInsert: () => editable() !== null,
    insert: (kind, text) => {
      const editor = editable();
      const trimmed = text.trim();
      if (!editor || trimmed.length === 0) return null;
      const id = nextNoteId(lists[kind]);
      if (!insertNoteRef(editor, kind, id, lists[kind].length + 1)) return null;
      const note: DocxNoteInfo = { id, text: trimmed };
      lists[kind] = [...lists[kind], note];
      edited[kind] = true;
      touch(editor);
      return { ...note };
    },
    setText: (kind, id, text) => {
      const trimmed = text.trim();
      if (!editable() || trimmed.length === 0) return false;
      const at = lists[kind].findIndex((note) => note.id === id);
      if (at < 0) return false;
      const next = [...lists[kind]];
      next[at] = editedNote(next[at]!, trimmed);
      lists[kind] = next;
      edited[kind] = true;
      touch(getEditor()!);
      return true;
    },
    remove: (kind, id) => {
      const editor = editable();
      if (!editor) return false;
      const at = lists[kind].findIndex((note) => note.id === id);
      if (at < 0) return false;
      lists[kind] = lists[kind].filter((note) => note.id !== id);
      edited[kind] = true;
      removeNoteRefs(editor, kind, id);
      // the survivors renumber by part order, so their markers must follow
      renumberNoteRefs(editor, kind, noteNumbers(lists[kind]));
      touch(editor);
      return true;
    },
    hasRef: (kind, id) => {
      const editor = getEditor();
      return editor !== null && hasNoteRef(editor, kind, id);
    },
    jump: (kind, id) => {
      const editor = getEditor();
      return editor !== null && jumpToNoteRef(editor, kind, id);
    },
    snapshot: () => ({ ...copyLists(), edited: { ...edited } }),
    restore: (snapshot) => {
      lists.footnote = snapshot.footnotes.map((note) => ({ ...note }));
      lists.endnote = snapshot.endnotes.map((note) => ({ ...note }));
      edited.footnote = snapshot.edited.footnote;
      edited.endnote = snapshot.edited.endnote;
    },
  };
}
