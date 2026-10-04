// B6 (UNI-924): the page-decoration command area. It owns the open document's
// read state (seeded from the parse), the pending ops the dialog records and
// the snapshot channel that replays them onto the save session. Ops are the
// engine's own DocxPageDecorEdit union, so the snapshot needs no translation.
import type { Editor } from "@tiptap/core";
import {
  normalizePageDecorEdit,
  type DocxAdapter,
  type DocxPageDecorEdit,
} from "@uniwork/office-engine/docx";
import {
  activeDecorSectionIndex,
  applyDecorEditToView,
  cloneDecorView,
  decorViewFromParsed,
  type DocxPageDecorView,
} from "../page-decor/docx-page-decor";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxPageDecorEdit } from "@uniwork/office-engine/docx";

export interface DocxPageDecorFormatState {
  /** The document's decoration state + the cursor's section; null before open. */
  docxPageDecor: DocxPageDecorView | null;
}

export interface DocxPageDecorCommands {
  /** Open hook: seed the read state from the engine parse. */
  seedDocxPageDecor(parsed: unknown): void;
  /** Snapshot channel: the pending ops, in apply order. */
  listDocxPageDecorEdits(): DocxPageDecorEdit[];
  /** Draft restore: re-seed the pending ops and the display state. */
  restoreDocxPageDecorEdits(edits: readonly DocxPageDecorEdit[] | undefined): void;
  /** Save hook: replay the pending ops onto a save session. */
  applyDocxPageDecorEdits(adapter: Pick<DocxAdapter, "edit">, ref: string): void;
  /** Record the dialog's ops (validated + normalized) and mirror them. */
  applyDocxPageDecor(edits: readonly DocxPageDecorEdit[]): boolean;
}

function cloneDecorEdit(edit: DocxPageDecorEdit): DocxPageDecorEdit {
  switch (edit.op) {
    case "set_page_color":
      return { op: edit.op, color: edit.color };
    case "set_watermark":
      return { op: edit.op, watermark: edit.watermark ? { ...edit.watermark } : null };
    case "set_theme_fonts":
      return { op: edit.op, fonts: { ...edit.fonts } };
    case "set_theme_colors":
      return { op: edit.op, colors: { ...edit.colors } };
    case "set_page_borders":
      return { op: edit.op, sectionIndex: edit.sectionIndex, borders: edit.borders ? { ...edit.borders } : null };
  }
}

export function createPageDecorCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxPageDecorCommands, DocxPageDecorFormatState> {
  /** The parse's own read state — restore falls back to it. */
  let seeded: DocxPageDecorView | null = null;
  let view: DocxPageDecorView | null = null;
  let edits: DocxPageDecorEdit[] = [];

  /** A save-transparent transaction (same shape as B4's page setup): marks the
   * document dirty without changing content or the undo history. */
  const touch = (): void => {
    const editor = context.getEditor();
    if (!editor || editor.isDestroyed || editor.state.doc.childCount === 0) return;
    const { state } = editor;
    const at = Math.min(
      state.doc.resolve(Math.min(state.selection.from, state.doc.content.size)).index(0),
      state.doc.childCount - 1,
    );
    let pos = 0;
    for (let i = 0; i < at; i += 1) pos += state.doc.child(i).nodeSize;
    const node = state.doc.child(at);
    const transaction = state.tr;
    transaction.setNodeMarkup(pos, undefined, { ...node.attrs }, node.marks);
    transaction.setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
  };

  return {
    commands: {
      seedDocxPageDecor: (parsed) => {
        seeded = decorViewFromParsed(parsed);
        view = seeded ? cloneDecorView(seeded) : null;
        edits = [];
      },
      listDocxPageDecorEdits: () => edits.map(cloneDecorEdit),
      restoreDocxPageDecorEdits: (next) => {
        edits = (next ?? []).map(cloneDecorEdit);
        view = seeded ? cloneDecorView(seeded) : null;
        for (const edit of edits) {
          if (view) view = applyDecorEditToView(view, edit);
        }
      },
      applyDocxPageDecorEdits: (adapter, ref) => {
        for (const edit of edits) adapter.edit(ref, edit);
      },
      applyDocxPageDecor: (ops) => {
        const editor = context.getEditor();
        if (!editor || editor.isDestroyed || ops.length === 0) return false;
        for (const op of ops) {
          const edit = normalizePageDecorEdit(op);
          edits.push(edit);
          if (view) view = applyDecorEditToView(view, edit);
        }
        touch();
        return true;
      },
    },
    readState: (editor: Editor | null) => ({
      docxPageDecor: view
        ? { ...cloneDecorView(view), activeIndex: activeDecorSectionIndex(editor, view.sections) }
        : null,
    }),
  };
}
