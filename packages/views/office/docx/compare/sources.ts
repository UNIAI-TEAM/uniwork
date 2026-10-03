// C2 (UNI-924): the two text sources Compare reads — the live editor's JSON
// and a parsed (compared) document's blocks. Both sides produce the same
// shape: one plain-text string per visible top-level block, in document order.
// The live document is only read here; nothing in this module edits it.

import type { JSONContent } from "@tiptap/core";
import type { RendererBlock } from "@uniwork/office-upstream/docs-renderer-editor";

/** Plain text of one parsed block: its runs, else the parse's own preview text
 * for protected blocks (tables, drawings, charts, …). */
export function rendererBlockText(block: RendererBlock): string {
  if (block.runs) return block.runs.map((run) => run.text).join("");
  return typeof block.previewText === "string" ? block.previewText : "";
}

/** Visible block texts in document order. Hidden (body-trailing) blocks are
 * not part of what the document shows, so they are not compared — the same
 * filter the vendored editor applies when it builds the surface. */
export function rendererBlockTexts(blocks: readonly RendererBlock[]): string[] {
  return blocks.filter((block) => !block.hidden).map(rendererBlockText);
}

function jsonText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(jsonText).join("");
}

/** One live-editor top-level node as text: protected blocks (images, drawings)
 * carry the same preview text the parse holds; every other node (paragraph,
 * heading, list item, table, …) contributes its plain text content. */
function editorNodeText(node: JSONContent): string {
  if (node.type === "docProtected") {
    return typeof node.attrs?.previewText === "string" ? node.attrs.previewText : "";
  }
  return jsonText(node);
}

/** The live document's visible block texts, from `editor.getJSON()`. */
export function editorJsonTexts(doc: JSONContent): string[] {
  return (doc.content ?? []).map(editorNodeText);
}
