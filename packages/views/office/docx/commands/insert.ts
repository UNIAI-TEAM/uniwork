import type { Editor } from "@tiptap/core";
import { inlineEquationContent } from "../insert/math";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

/** Task A11: symbols + equation insert, both inline within existing node types. */
export interface DocxInsertCommands {
  /** Inserts a glyph at the caret/selection as plain text. */
  insertSymbol(text: string): void;
  /** Compiles LaTeX into the vendored docInlineMath node and inserts it;
   * false when the formula is unsupported or the document is not editable. */
  insertEquation(latex: string): boolean;
}

/** No insert-owned state: both commands act on the selection only. */
export type DocxInsertFormatState = object;

function editable(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

export function createInsertCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxInsertCommands, DocxInsertFormatState> {
  const getEditor = () => context.getEditor();

  return {
    commands: {
      insertSymbol: (text) => {
        const editor = editable(getEditor());
        const value = text.trim();
        if (!editor || value === "") return;
        editor.chain().focus().insertContent({ type: "text", text: value }).run();
      },
      insertEquation: (latex) => {
        const editor = editable(getEditor());
        if (!editor) return false;
        try {
          return editor.chain().focus().insertContent(inlineEquationContent(latex)).run();
        } catch {
          return false;
        }
      },
    },
    readState: () => ({}),
  };
}
