// C2 (UNI-924): the Compare command area. It contributes one read-only
// reader over the live editor (the "current document" side of a comparison)
// and the readiness flag the Review entry gates on. Nothing here edits the
// document: the reader takes `editor.getJSON()`, and the compared file is
// parsed off-session in ../compare/read-compare.ts.
import type { Editor } from "@tiptap/core";
import { editorJsonTexts } from "../compare/sources";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export interface DocxCompareCommands {
  /** Visible block texts of the live document, in document order (text only). */
  compareDocumentTexts(): string[];
}

export interface DocxCompareFormatState {
  /** True once the live editor exists; the Review ▸ Compare entry stays
   * disabled until a document is open. */
  docxCompareReady: boolean;
}

export function createCompareCommands({ getEditor }: DocxCommandFactoryContext): DocxCommandArea<DocxCompareCommands, DocxCompareFormatState> {
  return {
    commands: {
      compareDocumentTexts: () => {
        const editor = getEditor();
        return editor ? editorJsonTexts(editor.getJSON()) : [];
      },
    },
    readState: (editor: Editor | null) => ({ docxCompareReady: editor !== null }),
  };
}
