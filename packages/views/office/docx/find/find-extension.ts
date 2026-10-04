import { Extension, type Editor } from "@tiptap/core";
import { getDocxLiveEditor, publishDocxEditor, subscribeDocxLiveEditor } from "../editor-store";
import { createDocxFindPlugin } from "./find-decoration";
import { closeDocxFind } from "./find-store";

/** The live editor the find surface searches; null while no document is open.
 * Re-exported from the shared editor store so every chrome subtree reads one
 * source (see ../../editor-store.ts). */
export const getDocxFindEditor = getDocxLiveEditor;
export const subscribeDocxFindEditor = subscribeDocxLiveEditor;

function publish(editor: Editor | null): void {
  if (getDocxLiveEditor() === editor) return;
  // A fresh document starts with Find closed, the way Word does it: the open
  // state must not leak across an editor teardown into the next document.
  if (!editor) closeDocxFind();
  publishDocxEditor(editor);
}

/**
 * Schema-level find layer, registered by docx-schema.ts. The panel and the
 * toolbar group are mounted in different shell subtrees and the shared context
 * carries only the host handle, so the editor is published through the shared
 * editor store instead of being threaded through as a prop.
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
    if (getDocxLiveEditor() === this.editor) publish(null);
  },
});
