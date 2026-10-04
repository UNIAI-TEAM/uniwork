import type { DocxCommandArea, DocxCommandFactoryContext } from "./context";
import { applyLink, getActiveLink, readLinkSeed, removeLink } from "../links/link-commands";
import type { DocxLinkInput, DocxLinkSeed, DocxLinksCommands, DocxLinksFormatState } from "../links/link-commands";

export type { DocxLinksCommands, DocxLinksFormatState } from "../links/link-commands";

/** A4: the link area's factory. Commands wrap the editor-level functions in
 * ../links/link-commands, which also own the dialog/chip surface. */
export function createLinksCommands(context: DocxCommandFactoryContext): DocxCommandArea<DocxLinksCommands, DocxLinksFormatState> {
  return {
    commands: {
      linkSeed: (): DocxLinkSeed => {
        const editor = context.getEditor();
        return editor ? readLinkSeed(editor) : { link: null, selectionText: "" };
      },
      applyLink: (input: DocxLinkInput): boolean => {
        const editor = context.getEditor();
        return editor ? applyLink(editor, input) : false;
      },
      removeLink: (): boolean => {
        const editor = context.getEditor();
        return editor ? removeLink(editor) : false;
      },
    },
    readState: (editor) => ({ activeLink: editor ? getActiveLink(editor) : null }),
  };
}
