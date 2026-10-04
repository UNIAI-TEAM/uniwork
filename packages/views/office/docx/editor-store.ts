// The live DOCX TipTap editor, published once per editing surface and read by
// chrome that lives in another React subtree from the toolbar context (which
// carries only the host handle). The find panel, the status bar and the Insert
// tab's image entry all need the editor; the editing handle keeps it private,
// so the schema extension (docx-schema.ts -> find/find-extension.ts) publishes
// it here. One editing surface per host page, the same assumption the view zoom
// controller makes.
import type { Editor } from "@tiptap/core";

let current: Editor | null = null;
const listeners = new Set<() => void>();

/** Publish the mounted editor; null clears it when the surface is destroyed. */
export function publishDocxEditor(editor: Editor | null): void {
  if (current === editor) return;
  current = editor;
  for (const listener of listeners) listener();
}

/** The live editor the chrome reads; null while no document is open. */
export function getDocxLiveEditor(): Editor | null {
  return current;
}

export function subscribeDocxLiveEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
