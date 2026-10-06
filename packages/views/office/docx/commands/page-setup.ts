// B4 (UNI-924): the page-setup command area. It owns the open document's
// section list (seeded from the parse), the pending per-section edits and the
// snapshot channel that replays them onto the save session. The dialog drives
// it; a save-transparent transaction marks the document dirty because page
// setup lives outside the document.
import type { Editor } from "@tiptap/core";
import type { DocxAdapter, DocxSectionProperties } from "@uniwork/office-engine/docx";
import {
  activeSectionIndex,
  applyPropertiesToSection,
  clonePageSetupSection,
  sectionsFromParsed,
  type DocxPageSetupEdit,
  type DocxPageSetupSection,
  type DocxPageSetupState,
} from "../page-setup/docx-page-setup";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxPageSetupEdit } from "../page-setup/docx-page-setup";

export interface DocxPageSetupFormatState {
  /** The document's sections + the cursor's section; null before open. */
  docxPageSetup: DocxPageSetupState | null;
}

export interface DocxPageSetupCommands {
  /** Open hook: seed the section list from the engine parse. */
  seedDocxPageSetup(parsed: unknown): void;
  /** Snapshot channel: the pending edits, in apply order. */
  listDocxPageSetupEdits(): DocxPageSetupEdit[];
  /** Draft restore: re-seed the pending edits and the display values. */
  restoreDocxPageSetupEdits(edits: readonly DocxPageSetupEdit[] | undefined): void;
  /** Save hook: replay the pending edits onto a save session. */
  applyDocxPageSetupEdits(adapter: Pick<DocxAdapter, "edit">, ref: string): void;
  /** Record a page-setup edit for one section (the dialog's target index). */
  setDocxSectionProperties(sectionIndex: number, properties: DocxSectionProperties): boolean;
}

export function createPageSetupCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxPageSetupCommands, DocxPageSetupFormatState> {
  /** The parse's own list — restore falls back to it. */
  let seeded: DocxPageSetupSection[] = [];
  let sections: DocxPageSetupSection[] = [];
  let edits: DocxPageSetupEdit[] = [];

  /** A save-transparent transaction. The save coordinator only marks a
   * document dirty when a transaction carries a step, and page setup lives
   * outside the document, so the block at the caret is re-marked with
   * identical attributes: steps.length > 0, no content change, not in the
   * undo history. */
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

  const cloneEdits = (source: readonly DocxPageSetupEdit[]): DocxPageSetupEdit[] =>
    source.map((edit) => ({ sectionIndex: edit.sectionIndex, properties: { ...edit.properties } }));

  return {
    commands: {
      seedDocxPageSetup: (parsed) => {
        sections = sectionsFromParsed(parsed);
        seeded = sections.map(clonePageSetupSection);
        edits = [];
      },
      listDocxPageSetupEdits: () => cloneEdits(edits),
      restoreDocxPageSetupEdits: (next) => {
        edits = cloneEdits(next ?? []);
        sections = seeded.map(clonePageSetupSection);
        for (const edit of edits) {
          const section = sections[edit.sectionIndex];
          if (section) sections[edit.sectionIndex] = applyPropertiesToSection(section, edit.properties);
        }
      },
      applyDocxPageSetupEdits: (adapter, ref) => {
        for (const edit of edits) {
          adapter.edit(ref, { op: "set_section_properties", sectionIndex: edit.sectionIndex, properties: { ...edit.properties } });
        }
      },
      setDocxSectionProperties: (sectionIndex, properties) => {
        const editor = context.getEditor();
        if (!editor || editor.isDestroyed || Object.keys(properties).length === 0) return false;
        const section = sections[sectionIndex];
        if (!section) return false;
        edits.push({ sectionIndex, properties: { ...properties } });
        sections = sections.map((entry) => (entry.index === sectionIndex ? applyPropertiesToSection(entry, properties) : entry));
        touch();
        return true;
      },
    },
    readState: (editor: Editor | null) => ({
      docxPageSetup:
        sections.length === 0
          ? null
          : { sections: sections.map(clonePageSetupSection), activeIndex: activeSectionIndex(editor, sections) },
    }),
  };
}
