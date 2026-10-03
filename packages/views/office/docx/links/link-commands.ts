import { getMarkRange, type Editor } from "@tiptap/core";
import type { DocxCommandArea, DocxCommandFactoryContext } from "../commands/context";

/** The link covering the caret/selection, as the dialog and chip need it. */
export interface DocxLinkTarget {
  from: number;
  to: number;
  href: string;
  text: string;
  tooltip: string | null;
}

/** What the dialog sends back. `undefined` tooltip keeps the stored one. */
export interface DocxLinkInput {
  href: string;
  text?: string;
  tooltip?: string | null;
}

/** The dialog's submitted values, every field materialized. */
export interface DocxLinkFormValue {
  href: string;
  text: string;
  tooltip: string | null;
}

export interface DocxLinkSeed {
  /** The link under the caret/selection when the dialog opens, if any. */
  link: DocxLinkTarget | null;
  /** Selected text for a fresh insert (empty when the selection is a caret). */
  selectionText: string;
}

const HTTP_HREF = /^https?:\/\/\S+$/i;
const MAILTO_HREF = /^mailto:\S+$/i;

/** UI-level check: only http(s) and mailto targets are offered; empty is invalid. */
export function isValidLinkHref(value: string): boolean {
  const href = value.trim();
  return HTTP_HREF.test(href) || MAILTO_HREF.test(href);
}

/** The href of the link mark under the caret, in the shape the apply functions build. */
export function getActiveLink(editor: Editor): DocxLinkTarget | null {
  const markType = editor.state.schema.marks.link;
  if (!markType) return null;
  const { $from, from, to, empty } = editor.state.selection;
  const range = getMarkRange($from, markType);
  if (!range) return null;
  // A non-empty selection reaching outside the link is a fresh insert over that
  // selection, not an edit of the link under its endpoint (Word behavior).
  if (!empty && (from < range.from || to > range.to)) return null;
  // Read the attrs from the run itself: at the link's trailing edge $from.marks()
  // drops inclusive:false marks, so the selection's own attributes come back empty.
  const node = editor.state.doc.nodeAt(range.from);
  const attrs = node?.marks.find((mark) => mark.type === markType)?.attrs;
  if (!attrs) return null;
  return {
    from: range.from,
    to: range.to,
    href: typeof attrs.href === "string" ? attrs.href : "",
    text: editor.state.doc.textBetween(range.from, range.to, " "),
    tooltip: typeof attrs.tooltip === "string" ? attrs.tooltip : null,
  };
}

export function readLinkSeed(editor: Editor): DocxLinkSeed {
  const { from, to, empty } = editor.state.selection;
  return {
    link: getActiveLink(editor),
    selectionText: empty ? "" : editor.state.doc.textBetween(from, to, " "),
  };
}

/** Creates a link over the selection (or inserts its text), or updates the link at the caret. */
export function applyLink(editor: Editor, input: DocxLinkInput): boolean {
  if (!editor.isEditable) return false;
  const href = input.href.trim();
  if (!isValidLinkHref(href)) return false;
  if (!editor.state.schema.marks.link) return false;
  const tooltip = input.tooltip === undefined ? undefined : input.tooltip?.trim() || null;
  const active = getActiveLink(editor);
  if (active) {
    const text = input.text?.trim() || active.text;
    const attrs = { href, rId: null, tooltip: tooltip === undefined ? active.tooltip : tooltip };
    if (text === active.text) {
      // Address-only change: re-mark the existing run so character formatting,
      // comments and inline objects survive; the stored ScreenTip follows the
      // field (an emptied field clears it).
      editor.chain().focus().setTextSelection({ from: active.from, to: active.to }).setMark("link", attrs).run();
    } else {
      editor
        .chain()
        .focus()
        .deleteRange({ from: active.from, to: active.to })
        .insertContentAt(active.from, { type: "text", text, marks: [{ type: "link", attrs }] })
        .run();
    }
    return true;
  }
  const { from, to, empty } = editor.state.selection;
  const selectionText = empty ? "" : editor.state.doc.textBetween(from, to, " ");
  const text = input.text?.trim() || selectionText.trim() || href;
  const attrs = { href, rId: null, tooltip: tooltip ?? null };
  if (!empty && text === selectionText.trim()) {
    // Untouched display text: mark the ORIGINAL selection instead of
    // re-inserting plain text — formatting and inline objects survive.
    editor.chain().focus().setTextSelection({ from, to }).setMark("link", attrs).run();
  } else {
    editor.chain().focus().insertContent({ type: "text", text, marks: [{ type: "link", attrs }] }).run();
  }
  return true;
}

/** Word's Remove Hyperlink: the text stays, only the link goes. */
export function removeLink(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const active = getActiveLink(editor);
  if (!active) return false;
  editor.chain().focus().setTextSelection({ from: active.from, to: active.to }).unsetMark("link").run();
  return true;
}

export interface DocxLinksCommands {
  /** Snapshot for opening the dialog: the link at the caret plus the selected text. */
  linkSeed(): DocxLinkSeed;
  applyLink(input: DocxLinkInput): boolean;
  removeLink(): boolean;
}

export interface DocxLinksFormatState {
  /** The link at the caret/selection; null when there is none. */
  activeLink: DocxLinkTarget | null;
}

/** A4's contribution to the command seam (commands/links.ts re-exports this). */
export function createLinksCommandArea(
  context: DocxCommandFactoryContext,
): DocxCommandArea<DocxLinksCommands, DocxLinksFormatState> {
  return {
    commands: {
      linkSeed: () => {
        const editor = context.getEditor();
        return editor ? readLinkSeed(editor) : { link: null, selectionText: "" };
      },
      applyLink: (input) => {
        const editor = context.getEditor();
        return editor ? applyLink(editor, input) : false;
      },
      removeLink: () => {
        const editor = context.getEditor();
        return editor ? removeLink(editor) : false;
      },
    },
    readState: (editor) => ({ activeLink: editor ? getActiveLink(editor) : null }),
  };
}
