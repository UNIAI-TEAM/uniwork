// A13 wire (UNI-924): the header/footer command area. It owns the open
// document's six-slot read state (seeded from the engine parse), the pending
// set_header_footer / set_title_pg / set_even_odd_headers edits and the
// snapshot channel that replays them onto the save session. The panel drives
// it; a save-transparent transaction marks the document dirty because the
// header/footer parts live outside the body plan.
import type { Editor } from "@tiptap/core";
import type { DocxAdapter, DocxEdit, DocxHeaderFooter, DocxHfSlot } from "@uniwork/office-engine/docx";
import {
  readDocxHeaderFooterState,
  setEvenOddHeadersEdit,
  setHeaderFooterEdit,
  setTitlePgEdit,
  type DocxHeaderFooterState,
} from "../header-footer/header-footer-state";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxHeaderFooterState } from "../header-footer/header-footer-state";

export interface DocxHeaderFooterFormatState {
  /** The six slots + the two variant flags; null before a document is open. */
  docxHeaderFooter: DocxHeaderFooterState | null;
}

export interface DocxHeaderFooterCommands {
  /** Open hook: seed the read state from the engine parse. */
  seedDocxHeaderFooter(parsed: unknown): void;
  /** Snapshot channel: the pending edits, in apply order. */
  listDocxHeaderFooterEdits(): DocxEdit[];
  /** Draft restore: re-seed the pending edits and the display state. */
  restoreDocxHeaderFooterEdits(edits: readonly DocxEdit[] | undefined): void;
  /** Save hook: replay the pending edits onto a save session. */
  applyDocxHeaderFooterEdits(adapter: Pick<DocxAdapter, "edit">, ref: string): void;
  /** Set (or clear, with null) one slot's content; false = nothing to do. */
  setDocxHeaderFooterSlot(slot: DocxHfSlot, hf: DocxHeaderFooter | null): boolean;
  /** w:titlePg - give the first page its own header/footer; false = no change. */
  setDocxTitlePg(value: boolean): boolean;
  /** settings.xml w:evenAndOddHeaders; false = no change. */
  setDocxEvenOddHeaders(value: boolean): boolean;
}

export function createHeaderFooterCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxHeaderFooterCommands, DocxHeaderFooterFormatState> {
  /** The parse's own read state - restore falls back to it. */
  let seeded: DocxHeaderFooterState | null = null;
  let state: DocxHeaderFooterState | null = null;
  let edits: DocxEdit[] = [];

  /** A save-transparent transaction (same shape as B4/B6): marks the document
   * dirty without changing content or the undo history. */
  const touch = (): void => {
    const editor = context.getEditor();
    if (!editor || editor.isDestroyed || editor.state.doc.childCount === 0) return;
    const { state: editorState } = editor;
    const at = Math.min(
      editorState.doc.resolve(Math.min(editorState.selection.from, editorState.doc.content.size)).index(0),
      editorState.doc.childCount - 1,
    );
    let pos = 0;
    for (let i = 0; i < at; i += 1) pos += editorState.doc.child(i).nodeSize;
    const node = editorState.doc.child(at);
    const transaction = editorState.tr;
    transaction.setNodeMarkup(pos, undefined, { ...node.attrs }, node.marks);
    transaction.setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
  };

  const cloneSlot = (value: DocxHeaderFooter | null): DocxHeaderFooter | null =>
    value === null ? null : { ...value, ...(value.paras ? { paras: [...value.paras] } : {}) };

  const cloneState = (source: DocxHeaderFooterState): DocxHeaderFooterState => ({
    slots: {
      header: { ...source.slots.header, value: cloneSlot(source.slots.header.value) },
      footer: { ...source.slots.footer, value: cloneSlot(source.slots.footer.value) },
      headerFirst: { ...source.slots.headerFirst, value: cloneSlot(source.slots.headerFirst.value) },
      footerFirst: { ...source.slots.footerFirst, value: cloneSlot(source.slots.footerFirst.value) },
      headerEven: { ...source.slots.headerEven, value: cloneSlot(source.slots.headerEven.value) },
      footerEven: { ...source.slots.footerEven, value: cloneSlot(source.slots.footerEven.value) },
    },
    titlePg: source.titlePg,
    evenAndOddHeaders: source.evenAndOddHeaders,
  });

  return {
    commands: {
      seedDocxHeaderFooter: (parsed) => {
        seeded = readDocxHeaderFooterState(parsed as Parameters<typeof readDocxHeaderFooterState>[0]);
        state = seeded ? cloneState(seeded) : null;
        edits = [];
      },
      listDocxHeaderFooterEdits: () => edits.map((edit) => ({ ...edit }) as DocxEdit),
      restoreDocxHeaderFooterEdits: (next) => {
        edits = (next ?? []).map((edit) => ({ ...edit }) as DocxEdit);
        state = seeded ? cloneState(seeded) : null;
        for (const edit of edits) {
          if (!state) break;
          if (edit.op === "set_header_footer") {
            state.slots[edit.slot] = { ...state.slots[edit.slot], value: cloneSlot(edit.hf) };
          } else if (edit.op === "set_title_pg") {
            state.titlePg = edit.value;
          } else if (edit.op === "set_even_odd_headers") {
            state.evenAndOddHeaders = edit.value;
          }
        }
      },
      applyDocxHeaderFooterEdits: (adapter, ref) => {
        for (const edit of edits) adapter.edit(ref, edit);
      },
      setDocxHeaderFooterSlot: (slot, hf) => {
        const editor = context.getEditor();
        if (!editor || editor.isDestroyed || !state) return false;
        edits.push(setHeaderFooterEdit(slot, hf));
        state.slots[slot] = { ...state.slots[slot], value: cloneSlot(hf) };
        touch();
        return true;
      },
      setDocxTitlePg: (value) => {
        const editor = context.getEditor();
        if (!editor || editor.isDestroyed || !state || state.titlePg === value) return false;
        edits.push(setTitlePgEdit(value));
        state.titlePg = value;
        touch();
        return true;
      },
      setDocxEvenOddHeaders: (value) => {
        const editor = context.getEditor();
        if (!editor || editor.isDestroyed || !state || state.evenAndOddHeaders === value) return false;
        edits.push(setEvenOddHeadersEdit(value));
        state.evenAndOddHeaders = value;
        touch();
        return true;
      },
    },
    readState: (_editor: Editor | null) => ({ docxHeaderFooter: state ? cloneState(state) : null }),
  };
}