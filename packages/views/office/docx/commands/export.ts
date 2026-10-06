// C1 (UNI-924): the export command area — print, standalone HTML export and
// the Blob download. The runtime keeps the TipTap instance behind getEditor(),
// so every command re-reads the live editor instead of capturing one; the
// toolbar group drives these commands and owns only its open/closed state.
import type { Editor, JSONContent } from "@tiptap/core";
import { readDocxExportContext } from "../export/docx-export-context";
import { downloadDocxHtmlFile } from "../export/docx-download";
import { docxDocumentToHtml } from "../export/docx-html-export";
import { installDocxPrintStyles, printDocxDocument } from "../export/docx-print";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export interface DocxExportFormatState {
  /** A live editor is mounted, so the document can be printed or exported. */
  docxExportReady: boolean;
}

export interface DocxExportCommands {
  /** Opens the browser print dialog with the paginated surface as its target. */
  printDocx(): boolean;
  /** The standalone HTML file for the current document; null when none is open. */
  exportDocxHtml(title?: string): string | null;
  /** Serializes and downloads through a Blob; false when nothing is open or the host refuses.
   * The caller's localized strings are used: the command seam exposes no document title. */
  downloadDocxHtml(fileName: string, title?: string): boolean;
}

export function createExportCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxExportCommands, DocxExportFormatState> {
  const liveEditor = (): Editor | null => {
    const editor = context.getEditor();
    return editor && !editor.isDestroyed ? editor : null;
  };

  // UNI-957: the DOM of the document these commands drive, so print and the
  // export facts never read another DOCX mounted in the same page.
  // An editor that is not mounted yet has no view; the page-wide default applies.
  const ownRoot = (editor: Editor): ParentNode | undefined => {
    try {
      return (editor.view.dom as HTMLElement).closest('[data-testid="docx-editor"]') ?? undefined;
    } catch {
      return undefined;
    }
  };

  const exportHtml = (title?: string): string | null => {
    const editor = liveEditor();
    if (!editor) return null;
    const doc: JSONContent = editor.getJSON();
    return docxDocumentToHtml(doc, { title, ...readDocxExportContext(ownRoot(editor)) });
  };

  return {
    commands: {
      printDocx() {
        const editor = liveEditor();
        if (!editor) return false;
        installDocxPrintStyles();
        return printDocxDocument(window, ownRoot(editor));
      },
      exportDocxHtml: (title) => exportHtml(title),
      downloadDocxHtml(fileName, title) {
        const html = exportHtml(title);
        if (html === null) return false;
        return downloadDocxHtmlFile(html, fileName);
      },
    },
    readState: (editor) => ({ docxExportReady: !!editor && !editor.isDestroyed }),
  };
}
