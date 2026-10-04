// A12 (UNI-924): the review command area — tracked-change list plus
// accept/reject/jump over the live editor. The panel and the toolbar group
// read the list from the composed format state; every mutation goes through
// the vendored revision shapes in ../review/revision-apply.ts.
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { applyReviewChanges, jumpToReviewChange } from "../review/revision-apply";
import { collectReviewChanges, findReviewChange, type DocxReviewChange } from "../review/revision-model";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export interface DocxReviewFormatState {
  /** The document's tracked changes, in document order. */
  reviewChanges: DocxReviewChange[];
}

export interface DocxReviewCommands {
  /** Tracked changes of the current document (cached per document version). */
  listReviewChanges(): DocxReviewChange[];
  /** Accept one change by the id the list published; false when stale. */
  acceptReviewChange(id: string): boolean;
  /** Reject one change by the id the list published; false when stale. */
  rejectReviewChange(id: string): boolean;
  /** Accept every change; false when there is nothing to accept. */
  acceptAllReviewChanges(): boolean;
  /** Reject every change; false when there is nothing to reject. */
  rejectAllReviewChanges(): boolean;
  /** Select the change and scroll it into view; false when the id is stale. */
  jumpToReviewChange(id: string): boolean;
}

export function createReviewCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxReviewCommands, DocxReviewFormatState> {
  // A full document walk is only needed when the doc version changes: the
  // editor state's doc is immutable, so the collected list is reused across
  // the transactions that only move the selection (the upstream renderer
  // caches its revision count the same way).
  let cachedDoc: PmNode | null = null;
  let cachedChanges: DocxReviewChange[] = [];

  const changesFor = (editor: Editor | null): DocxReviewChange[] => {
    if (!editor) {
      cachedDoc = null;
      cachedChanges = [];
      return cachedChanges;
    }
    if (cachedDoc !== editor.state.doc) {
      cachedDoc = editor.state.doc;
      cachedChanges = collectReviewChanges(editor.state.doc);
    }
    return cachedChanges;
  };

  const apply = (id: string, mode: "accept" | "reject"): boolean => {
    const editor = context.getEditor();
    if (!editor || !editor.isEditable) return false;
    const change = findReviewChange(changesFor(editor), id);
    if (!change) return false;
    return applyReviewChanges(editor, [change], mode);
  };

  const applyAll = (mode: "accept" | "reject"): boolean => {
    const editor = context.getEditor();
    if (!editor || !editor.isEditable) return false;
    const changes = collectReviewChanges(editor.state.doc);
    if (changes.length === 0) return false;
    return applyReviewChanges(editor, changes, mode);
  };

  return {
    commands: {
      listReviewChanges: () => changesFor(context.getEditor()),
      acceptReviewChange: (id) => apply(id, "accept"),
      rejectReviewChange: (id) => apply(id, "reject"),
      acceptAllReviewChanges: () => applyAll("accept"),
      rejectAllReviewChanges: () => applyAll("reject"),
      jumpToReviewChange: (id) => {
        const editor = context.getEditor();
        if (!editor) return false;
        const change = findReviewChange(changesFor(editor), id);
        if (!change) return false;
        return jumpToReviewChange(editor, change);
      },
    },
    readState: (editor) => ({ reviewChanges: changesFor(editor) }),
  };
}
