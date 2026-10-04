// B7 (UNI-924): the TOC/caption/citation command area. Each command is a thin
// editor-side operation (../toc/toc-actions); the body edits it produces ride
// the normal TipTap document -> save plan path, so no save channel is needed.
// The format state carries the one fact the toolbar needs: whether a TOC node
// run exists (the Update entry is disabled without one).
import type { Editor } from "@tiptap/core";
import {
  docxTocPresent,
  insertDocxCaption,
  insertDocxCitation,
  insertDocxToc,
  readTocHeadings,
  updateDocxToc,
  type DocxTocInsertOutcome,
  type DocxTocUpdateOutcome,
} from "../toc/toc-actions";
import type { DocxTocFieldOptions, DocxTocHeading } from "../toc/toc-model";
import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";

export type { DocxTocFieldOptions, DocxTocHeading } from "../toc/toc-model";
export type { DocxTocInsertOutcome, DocxTocUpdateOutcome } from "../toc/toc-actions";

export interface DocxTocFormatState {
  /** A TOC node run is present at the top level (inserted or parsed). */
  docxTocPresent: boolean;
}

export interface DocxTocCommands {
  /** Insert a TOC field at the caret; "empty" means no heading matched the
   * depth, "read_only" means the document cannot be edited. */
  insertDocxToc(options: DocxTocFieldOptions): DocxTocInsertOutcome;
  /** Regenerate the document's TOC entries; "missing" means it has no TOC. */
  updateDocxToc(options: DocxTocFieldOptions): DocxTocUpdateOutcome;
  /** Insert a caption paragraph labeled + numbered with a SEQ field. */
  insertDocxCaption(label: string, text: string): boolean;
  /** Insert a bracketed reference at the caret (basic citation). */
  insertDocxCitation(author: string, year: string): boolean;
  /** Headings the live document would put in a TOC up to `maxLevel`. */
  readDocxTocHeadings(maxLevel: number): DocxTocHeading[];
}

export function createTocCommands(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxTocCommands, DocxTocFormatState> {
  const getEditor = (): Editor | null => context.getEditor();

  return {
    commands: {
      insertDocxToc: (options) => insertDocxToc(getEditor(), options),
      updateDocxToc: (options) => updateDocxToc(getEditor(), options),
      insertDocxCaption: (label, text) => insertDocxCaption(getEditor(), label, text),
      insertDocxCitation: (author, year) => insertDocxCitation(getEditor(), author, year),
      readDocxTocHeadings: (maxLevel) => readTocHeadings(getEditor(), maxLevel),
    },
    readState: (editor) => ({ docxTocPresent: docxTocPresent(editor) }),
  };
}
