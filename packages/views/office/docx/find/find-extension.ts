import { Extension, type Editor } from "@tiptap/core";
import { createDocxFindPlugin } from "./find-decoration";

let current: Editor | null = null;
const listeners = new Set<() => void>();

function publish(editor: Editor | null): void {
  if (current === editor) return;
  current = editor;
  for (const listener of listeners) listener();
}

/** The live editor the find surface searches; null while no document is open. */
export function getDocxFindEditor(): Editor | null {
  return current;
}

export function subscribeDocxFindEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Schema-level find layer, registered by docx-schema.ts. The panel and the
 * toolbar group are mounted in different shell subtrees and the shared context
 * carries only the host handle, so the editor is published here instead of
 * being threaded through as a prop. One editing surface per host page, the same
 * assumption the view zoom controller makes.
 */
export const DocxFindExtension = Extension.create({
  name: "docxFind",
  addProseMirrorPlugins() {
    // Runs inside the editor constructor, before any host render reads the
    // store; onDestroy (payloadless) clears it again.
    publish(this.editor);
    return [createDocxFindPlugin()];
  },
  onDestroy() {
    if (current === this.editor) publish(null);
  },
});
