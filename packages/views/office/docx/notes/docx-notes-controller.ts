// The note state machine over one live TipTap editor: the authoritative
// footnote/endnote lists (seeded from the open parse's parts) plus every
// reference mutation. Mirrors the upstream review-actions note paths
// (review-actions.ts:62-107), adapted to the UniWork command seam so the pane
// never touches the editor directly.
import type { Editor } from "@tiptap/core";
import type { DocxNoteInfo, DocxNoteKind } from "@uniwork/office-engine/docx";
import { editedNote, nextNoteId, noteNumbersOf } from "./docx-note-model";
import { canInsertNoteRef, hasNoteRef, insertNoteRef, jumpToNoteRef, noteRefsOf, removeNoteRefs, renumberNoteRefs } from "./docx-note-refs";

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
  /** Monotonic mutation counter: every accepted list edit advances it, so a
   * host can detect note-only changes that leave docChanged false (the F1
   * dirty-generation fold, mirroring the comments revision). Seeding and a
   * draft restore are not user mutations. */
  revision(): number;
  /** True while an editable document can take a new marker at the caret. */
  canInsert(): boolean;
  /** New note + marker at the caret; null without an editable caret or text. */
  insert(kind: DocxNoteKind, text: string): DocxNoteInfo | null;
  /** Edit a note's text; false for a blank body or an unknown id. */
  setText(kind: DocxNoteKind, id: string, text: string): boolean;
  /** Delete a note and its markers; the survivors renumber in the document. */
  remove(kind: DocxNoteKind, id: string): boolean;
  hasRef(kind: DocxNoteKind, id: string): boolean;
  /** Display numbers per note id, by body-reference order (the same
   * `noteNumbersOf` rule the in-text markers use), so the pane badge and the
   * marker never disagree (visual M-5). Part order for unreferenced notes. */
  numbers(kind: DocxNoteKind): Map<string, number>;
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
  let revision = 0;
  // The document's own w:numStart per kind, observed once from the engine's
  // already correct first reference when the parse parts are seeded. The parts
  // that carry w:numStart/w:numRestart are not reachable from this controller,
  // and a document with no counted reference yet offers nothing to observe.
  const numStart: Record<DocxNoteKind, number> = { footnote: 1, endnote: 1 };

  /** Force a state re-read after a list-only mutation: an empty transaction
   * runs TipTap's own onTransaction -> emitState cycle while docChanged stays
   * false. The revision bump each accepted mutation makes is what the handle
   * folds into the save generation (F1) — docChanged stays false, the dirty
   * signal does not (same as the comments pane). */
  const touch = (editor: Editor) => {
    editor.view.dispatch(editor.state.tr);
  };

  const editable = (): Editor | null => {
    const editor = getEditor();
    return editor !== null && !editor.isDestroyed && editor.isEditable ? editor : null;
  };

  /** Re-number one kind's markers in body-reference order, mirroring the
   * vendored rule (`noteNumbersOf`, docx-engine/src/parse.ts:5597). */
  const renumber = (editor: Editor, kind: DocxNoteKind) => {
    const refIds = noteRefsOf(editor, kind).map((ref) => ref.id);
    renumberNoteRefs(editor, kind, noteNumbersOf(refIds, lists[kind], numStart[kind]));
  };

  /** Pick up the document's display base from its first counted reference:
   * with no reference yet there is no number to preserve. */
  const observeNumStart = (editor: Editor) => {
    for (const kind of ["footnote", "endnote"] as const) {
      const known = new Set(lists[kind].map((note) => note.id));
      const first = noteRefsOf(editor, kind).find((ref) => known.has(ref.id));
      numStart[kind] = first?.num ?? 1;
    }
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
      const editor = getEditor();
      if (editor) observeNumStart(editor);
    },
    list: (kind) => lists[kind].map((note) => ({ ...note })),
    revision: () => revision,
    canInsert: () => {
      const editor = editable();
      return editor !== null && canInsertNoteRef(editor);
    },
    insert: (kind, text) => {
      const editor = editable();
      const trimmed = text.trim();
      if (!editor || trimmed.length === 0) return null;
      const id = nextNoteId(lists[kind]);
      if (!insertNoteRef(editor, kind, id, lists[kind].length + 1)) return null;
      const note: DocxNoteInfo = { id, text: trimmed };
      lists[kind] = [...lists[kind], note];
      edited[kind] = true;
      renumber(editor, kind);
      revision += 1;
      touch(editor);
      return { ...note };
    },
    setText: (kind, id, text) => {
      const editor = editable();
      const trimmed = text.trim();
      if (!editor || trimmed.length === 0) return false;
      const at = lists[kind].findIndex((note) => note.id === id);
      if (at < 0) return false;
      const next = [...lists[kind]];
      next[at] = editedNote(next[at]!, trimmed);
      lists[kind] = next;
      edited[kind] = true;
      revision += 1;
      touch(editor);
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
      // the survivors renumber by body-reference order, so their markers must follow
      renumber(editor, kind);
      revision += 1;
      touch(editor);
      return true;
    },
    hasRef: (kind, id) => {
      const editor = getEditor();
      return editor !== null && hasNoteRef(editor, kind, id);
    },
    numbers: (kind) => {
      const editor = getEditor();
      if (editor === null) return new Map();
      const refIds = noteRefsOf(editor, kind).map((ref) => ref.id);
      return noteNumbersOf(refIds, lists[kind], numStart[kind]);
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
