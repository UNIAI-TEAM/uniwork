// The comment state machine over one live TipTap editor: the authoritative
// list (seeded from the open parse's word/comments.xml at open) plus every
// anchor mutation. Mirrors the upstream review-actions paths (editor marks +
// review-actions.ts), adapted to the UniWork command seam so the panel never
// touches the editor directly.
import type { Editor } from "@tiptap/core";
import type { DocxCommentInfo } from "@uniwork/office-engine/docx";
import {
  addCommentAnchor,
  addCommentIdToAnchor,
  collectCommentAnchorTexts,
  hasCommentAnchor,
  jumpToCommentAnchor,
  removeCommentAnchor,
  selectionRange,
} from "./docx-comment-anchors";
import {
  applyThreadResolved,
  commentRootId,
  commentTimestamp,
  nextCommentId,
  removeThread,
  threadIds,
} from "./docx-comment-model";

/** The controller surface the command factory publishes. */
export interface DocxCommentsController {
  /** Replace the list (open/rebase: the parse's own comments). */
  seed(comments: DocxCommentInfo[]): void;
  list(): DocxCommentInfo[];
  /** Monotonic mutation counter: every accepted list edit advances it, so a
   * host can detect comment-only changes that leave docChanged false (the F1
   * dirty-generation fold). Seeding is not a mutation. */
  revision(): number;
  /** True while the caret/selection can take a new comment. */
  canComment(): boolean;
  /** New comment on the current selection; null when there is nothing to
   * anchor (empty selection, empty text, no editor). */
  add(text: string, author: string, initials?: string): DocxCommentInfo | null;
  /** Reply sharing the parent's anchor; null when the text is blank, the
   * parent is unknown, or the parent's anchor is gone. */
  reply(parentId: string, text: string, author: string, initials?: string): DocxCommentInfo | null;
  /** Resolve/reopen the whole thread; false for an unknown id. */
  resolve(id: string, done: boolean): boolean;
  /** Delete the thread (cascade: replies + their anchors go too). */
  remove(id: string): boolean;
  /** The open document still carries this comment's anchor. */
  hasAnchor(id: string): boolean;
  /** Anchor text per comment id, read from the rendered surface. */
  anchorTexts(): Map<string, string>;
  /** Scroll the anchor into view; false when there is no rendered span. */
  jump(id: string): boolean;
}

export function createDocxCommentsController(getEditor: () => Editor | null): DocxCommentsController {
  let list: DocxCommentInfo[] = [];
  let revision = 0;

  /** Force a state re-read after a mutation that did not touch the document
   * (resolve/reopen, a delete whose anchors are already gone): an empty
   * transaction runs TipTap's own onTransaction -> emitState cycle. The
   * revision bump below is what the handle folds into the save generation
   * (F1) — docChanged stays false, the dirty signal does not. */
  const touch = (editor: Editor) => {
    editor.view.dispatch(editor.state.tr);
  };

  return {
    seed: (comments) => {
      list = comments.map((comment) => ({ ...comment }));
    },
    list: () => list.map((comment) => ({ ...comment })),
    revision: () => revision,
    canComment: () => {
      const editor = getEditor();
      return editor !== null && selectionRange(editor) !== null;
    },
    add: (text, author, initials) => {
      const editor = getEditor();
      const trimmed = text.trim();
      if (!editor || trimmed.length === 0 || selectionRange(editor) === null) return null;
      const id = nextCommentId(list);
      if (!addCommentAnchor(editor, id)) return null;
      const comment: DocxCommentInfo = {
        id,
        author,
        text: trimmed,
        date: commentTimestamp(),
        ...(initials ? { initials } : {}),
      };
      list = [...list, comment];
      revision += 1;
      touch(editor);
      return { ...comment };
    },
    reply: (parentId, text, author, initials) => {
      const editor = getEditor();
      const trimmed = text.trim();
      if (!editor || trimmed.length === 0) return null;
      const parent = list.find((comment) => comment.id === parentId);
      if (!parent) return null;
      const id = nextCommentId(list);
      if (!addCommentIdToAnchor(editor, parentId, id)) return null;
      // Word resolves a thread as a unit: a reply into a resolved thread joins
      // the flag instead of listing as an open entry beside its resolved root.
      const root = list.find((comment) => comment.id === commentRootId(list, parentId));
      const comment: DocxCommentInfo = {
        id,
        author,
        text: trimmed,
        date: commentTimestamp(),
        parentId,
        ...(parent.done === true || root?.done === true ? { done: true } : {}),
        ...(initials ? { initials } : {}),
      };
      list = [...list, comment];
      revision += 1;
      touch(editor);
      return { ...comment };
    },
    resolve: (id, done) => {
      if (!list.some((comment) => comment.id === id)) return false;
      list = applyThreadResolved(list, id, done);
      revision += 1;
      const editor = getEditor();
      if (editor) touch(editor);
      return true;
    },
    remove: (id) => {
      if (!list.some((comment) => comment.id === id)) return false;
      const editor = getEditor();
      if (editor) {
        for (const victim of threadIds(list, id)) removeCommentAnchor(editor, victim);
      }
      list = removeThread(list, id);
      revision += 1;
      if (editor) touch(editor);
      return true;
    },
    hasAnchor: (id) => {
      const editor = getEditor();
      return editor !== null && hasCommentAnchor(editor, id);
    },
    anchorTexts: () => {
      const editor = getEditor();
      return editor ? collectCommentAnchorTexts(editor) : new Map<string, string>();
    },
    jump: (id) => {
      const editor = getEditor();
      return editor !== null && jumpToCommentAnchor(editor, id);
    },
  };
}
