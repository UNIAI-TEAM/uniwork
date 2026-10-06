import { Extension } from "@tiptap/core";
import { createDocxFindPlugin } from "./find-decoration";

/**
 * Schema-level find layer, registered by docx-schema.ts: only the decoration
 * plugin. The panel reads its editor from the document scope (../editor-store),
 * which the DocxEditor that renders the surface publishes (UNI-957: a schema
 * extension cannot tell which of several mounted documents it belongs to).
 */
export const DocxFindExtension = Extension.create({
  name: "docxFind",
  addProseMirrorPlugins() {
    return [createDocxFindPlugin()];
  },
});
