import type { Editor } from "@tiptap/core";
import type { DocxFormatCommands, DocxFormatState } from "../types";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Exactly the pre-wave command surface: the public DocxFormatCommands minus
 * the state read/subscribe the runtime owns. Keeping it derived means the base
 * and the published type can never drift apart. */
export type DocxBaseCommands = Omit<DocxFormatCommands, "getState" | "subscribe">;

function nextListId(): string {
  return "new-list-" + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
}

export function readBaseState(editor: Editor | null): DocxFormatState {
  if (!editor) return { bold: false, italic: false, underline: false, headingLevel: null, listKind: null };
  const node = editor.state.selection.$from.parent;
  const attrs = node.attrs;
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    headingLevel: node.type.name === "docHeading" ? (attrs.level ?? 1) : null,
    listKind: node.type.name === "docListItem" ? (attrs.kind ?? "bullet") : null,
  };
}

/** The bold/italic/underline/heading/list commands that moved out of
 * use-docx-tiptap-handle.ts; behaviour is unchanged. */
export function createBaseCommands(context: DocxCommandFactoryContext): DocxCommandArea<DocxBaseCommands, DocxFormatState> {
  const getEditor = () => context.getEditor();
  const setBlockType = (type: string, patch: Record<string, unknown>) => {
    const editor = getEditor();
    if (!editor) return;
    const attrs = editor.state.selection.$from.parent.attrs;
    editor.chain().focus().setNode(type, { ...attrs, ...patch }).run();
  };
  return {
    commands: {
      toggleBold: () => void getEditor()?.chain().focus().toggleMark("bold").run(),
      toggleItalic: () => void getEditor()?.chain().focus().toggleMark("italic").run(),
      toggleUnderline: () => void getEditor()?.chain().focus().toggleMark("underline").run(),
      setHeading: (level) => {
        if (level !== null && readBaseState(getEditor()).headingLevel === level) return;
        // The OOXML writer prioritizes an explicit paragraph style over the
        // heading level. Drop the old style when changing the semantic type.
        if (level === null) setBlockType("docParagraph", { styleId: null });
        else setBlockType("docHeading", { level, styleId: null, outlineOnly: false });
      },
      toggleList: (kind) => {
        if (readBaseState(getEditor()).listKind === kind) setBlockType("docParagraph", {});
        else setBlockType("docListItem", { kind, numId: nextListId(), ilvl: 0 });
      },
    },
    readState: readBaseState,
  };
}
