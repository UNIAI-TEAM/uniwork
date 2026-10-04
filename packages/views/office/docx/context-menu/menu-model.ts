import type { Editor } from "@tiptap/core";
import { mergeCells, splitCell } from "@tiptap/pm/tables";
import { getActiveLink, type DocxLinkTarget } from "../links";
import { isDocxInTable } from "./table-actions";

/**
 * What the right-click menu needs to know about the click point. Computed from
 * the live TipTap state at menu-render time; `readOnly` comes from the host
 * capability, not the editor, so a stub editor cannot grant editing.
 */
export interface DocxMenuContext {
  hasSelection: boolean;
  inTable: boolean;
  activeLink: DocxLinkTarget | null;
  readOnly: boolean;
  canMergeCells: boolean;
  canSplitCell: boolean;
}

export type DocxMenuItemId =
  | "cut"
  | "copy"
  | "paste"
  | "pastePlain"
  | "selectAll"
  | "insertRowAbove"
  | "insertRowBelow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteRow"
  | "deleteColumn"
  | "mergeCells"
  | "splitCell"
  | "toggleHeaderRow"
  | "openLink"
  | "copyLink"
  | "editLink"
  | "removeLink";

export interface DocxMenuItem {
  id: DocxMenuItemId;
  /** i18next key; the menu never carries a raw literal. */
  labelKey: string;
  enabled: boolean;
}

export interface DocxMenuSection {
  id: "clipboard" | "table" | "link";
  items: DocxMenuItem[];
}

/** A menu over an unopened editor has nothing to act on. */
const noEditorContext = (readOnly: boolean): DocxMenuContext => ({
  hasSelection: false,
  inTable: false,
  activeLink: null,
  readOnly,
  canMergeCells: false,
  canSplitCell: false,
});

export function readDocxMenuContext(editor: Editor | null, readOnly: boolean): DocxMenuContext {
  if (!editor) return noEditorContext(readOnly);
  const state = editor.state;
  const inTable = isDocxInTable(editor);
  return {
    hasSelection: !state.selection.empty,
    inTable,
    activeLink: getActiveLink(editor),
    readOnly,
    // Both predicates throw outside a table (they resolve a selection cell),
    // so the in-table check must short-circuit them.
    canMergeCells: inTable && mergeCells(state),
    canSplitCell: inTable && splitCell(state),
  };
}

export function buildDocxMenuSections(context: DocxMenuContext): DocxMenuSection[] {
  const { hasSelection, inTable, activeLink, readOnly, canMergeCells, canSplitCell } = context;
  const mutable = !readOnly;
  const sections: DocxMenuSection[] = [
    {
      id: "clipboard",
      items: [
        { id: "cut", labelKey: "office.docx.contextMenu.cut", enabled: hasSelection && mutable },
        { id: "copy", labelKey: "office.docx.contextMenu.copy", enabled: hasSelection },
        { id: "paste", labelKey: "office.docx.contextMenu.paste", enabled: mutable },
        { id: "pastePlain", labelKey: "office.docx.contextMenu.pastePlain", enabled: mutable },
        { id: "selectAll", labelKey: "office.docx.contextMenu.selectAll", enabled: true },
      ],
    },
  ];
  if (inTable) {
    sections.push({
      id: "table",
      items: [
        { id: "insertRowAbove", labelKey: "office.docx.contextMenu.insertRowAbove", enabled: mutable },
        { id: "insertRowBelow", labelKey: "office.docx.contextMenu.insertRowBelow", enabled: mutable },
        { id: "insertColumnLeft", labelKey: "office.docx.contextMenu.insertColumnLeft", enabled: mutable },
        { id: "insertColumnRight", labelKey: "office.docx.contextMenu.insertColumnRight", enabled: mutable },
        { id: "deleteRow", labelKey: "office.docx.contextMenu.deleteRow", enabled: mutable },
        { id: "deleteColumn", labelKey: "office.docx.contextMenu.deleteColumn", enabled: mutable },
        { id: "mergeCells", labelKey: "office.docx.contextMenu.mergeCells", enabled: mutable && canMergeCells },
        { id: "splitCell", labelKey: "office.docx.contextMenu.splitCell", enabled: mutable && canSplitCell },
        { id: "toggleHeaderRow", labelKey: "office.docx.contextMenu.toggleHeaderRow", enabled: mutable },
      ],
    });
  }
  if (activeLink) {
    sections.push({
      id: "link",
      items: [
        { id: "openLink", labelKey: "office.docx.links.open", enabled: activeLink.href.length > 0 },
        { id: "copyLink", labelKey: "office.docx.links.copy", enabled: activeLink.href.length > 0 },
        { id: "editLink", labelKey: "office.docx.links.edit", enabled: mutable },
        { id: "removeLink", labelKey: "office.docx.links.remove", enabled: mutable },
      ],
    });
  }
  return sections;
}
