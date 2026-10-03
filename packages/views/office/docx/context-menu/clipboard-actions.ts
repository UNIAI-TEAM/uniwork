import type { Editor } from "@tiptap/core";
import { insertPlainText, readPastePayload, type DocxPastePayload } from "./paste-options";

/** Word's clipboard verbs over the live editor, with the menu's plain-text lane. */

/**
 * Writes the selection as HTML+text when the host exposes the async clipboard
 * (web and Electron do), then falls back to the legacy copy command and finally
 * to plain text, so a permission-less host still copies something.
 */
export async function copySelection(editor: Editor): Promise<boolean> {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const text = editor.state.doc.textBetween(from, to, "\n");
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (typeof ClipboardItem !== "undefined" && clipboard?.write) {
    try {
      const { dom } = editor.view.serializeForClipboard(editor.state.doc.slice(from, to));
      await clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([dom.innerHTML], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      // Denied or unsupported payload; the fallbacks below still copy text.
    }
  }
  if (typeof document !== "undefined" && typeof document.execCommand === "function") {
    // The open popup may hold the DOM selection; refocus so the legacy copy grabs the editor's.
    editor.commands.focus();
    if (document.execCommand("copy")) return true;
  }
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Copy, then delete the selection only when the copy actually landed. */
export async function cutSelection(editor: Editor): Promise<boolean> {
  if (!editor.isEditable) return false;
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const copied = await copySelection(editor);
  if (!copied) return false;
  editor.chain().focus().deleteSelection().run();
  return true;
}

export async function readClipboardText(): Promise<string> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.readText) return "";
  try {
    return await clipboard.readText();
  } catch {
    return "";
  }
}

/** The rich copy first, its plain-text twin as fallback; null when the clipboard is empty. */
export async function readClipboardPayload(): Promise<DocxPastePayload | null> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.read) {
    try {
      const items = await clipboard.read();
      let html = "";
      let text = "";
      for (const item of items) {
        if (html.length === 0 && item.types.includes("text/html")) {
          html = await (await item.getType("text/html")).text();
        }
        if (text.length === 0 && item.types.includes("text/plain")) {
          text = await (await item.getType("text/plain")).text();
        }
      }
      const payload = readPastePayload({ html, text });
      if (payload) return payload;
    } catch {
      // read() is denied or absent outside a secure context; use readText.
    }
  }
  return readPastePayload({ html: "", text: await readClipboardText() });
}

/** Menu Paste: HTML through the editor's paste rules, plain text otherwise. */
export function insertPastePayload(editor: Editor, payload: DocxPastePayload): boolean {
  if (!editor.isEditable) return false;
  if (payload.html.length > 0) {
    return editor
      .chain()
      .focus()
      .insertContent(payload.html, { parseOptions: { preserveWhitespace: true } })
      .run();
  }
  return insertPlainText(editor, payload.text);
}

export function selectAll(editor: Editor): void {
  editor.chain().focus().selectAll().run();
}
