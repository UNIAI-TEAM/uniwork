"use client";

// B7 (UNI-924): the editor-side TOC/caption/citation operations. Every node
// they write is either the vendored schema's own (`docProtected` with a
// tocLine fieldDisplay + genXml, a `docParagraph` whose number run carries the
// inline-field mark) or plain text, so the existing save plan emits the field
// XML with no save-path change. Outcomes are typed and never throw for the
// ordinary refusals (read-only, no headings, no TOC) — the engine's own
// refusals still surface as a `refused` outcome rather than a crash.
import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { buildDocxTocLines } from "@uniwork/office-engine/docx";
import {
  countDocxCaptions,
  docxCaptionContent,
  docxCitationText,
  findDocxTocRange,
  readDocxTocHeadings,
  tocNodesForLines,
  type DocxTocDocNode,
  type DocxTocFieldOptions,
  type DocxTocHeading,
} from "./toc-model";

export interface DocxTocInsertOutcome {
  outcome: "inserted" | "empty" | "read_only" | "refused";
  entries: number;
}

export interface DocxTocUpdateOutcome {
  outcome: "updated" | "missing" | "empty" | "read_only" | "refused";
  entries: number;
}

function editable(editor: Editor | null): Editor | null {
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

/** The headings the live document would put in a TOC, up to `maxLevel`. */
export function readTocHeadings(editor: Editor | null, maxLevel: number): DocxTocHeading[] {
  if (!editor || editor.isDestroyed) return [];
  return readDocxTocHeadings(editor.state.doc as unknown as DocxTocDocNode, maxLevel);
}

/** True when the document carries a TOC node run (inserted or parsed). */
export function docxTocPresent(editor: Editor | null): boolean {
  if (!editor || editor.isDestroyed) return false;
  return findDocxTocRange(editor.state.doc as unknown as DocxTocDocNode) !== null;
}

/** Build the TOC nodes for the current heading set; null when the engine
 * refused the payload (nothing was written). */
function tocNodes(editor: Editor, options: DocxTocFieldOptions): JSONContent[] | null {
  const headings = readTocHeadings(editor, options.maxLevel);
  if (headings.length === 0) return null;
  try {
    return tocNodesForLines(buildDocxTocLines(headings, options));
  } catch {
    return null;
  }
}

/** Insert a TOC field at the caret (after a selected block, which a new node
 * must not replace). */
export function insertDocxToc(editor: Editor | null, options: DocxTocFieldOptions): DocxTocInsertOutcome {
  const live = editable(editor);
  if (!live) return { outcome: "read_only", entries: 0 };
  const nodes = tocNodes(live, options);
  if (!nodes) return { outcome: "empty", entries: 0 };
  const selection = live.state.selection;
  const inserted =
    selection instanceof NodeSelection
      ? live.chain().focus().insertContentAt(selection.to, nodes).run()
      : live.chain().focus().insertContent(nodes).run();
  return inserted ? { outcome: "inserted", entries: nodes.length } : { outcome: "refused", entries: 0 };
}

/** Replace the document's TOC node run with freshly generated entries. */
export function updateDocxToc(editor: Editor | null, options: DocxTocFieldOptions): DocxTocUpdateOutcome {
  const live = editable(editor);
  if (!live) return { outcome: "read_only", entries: 0 };
  const range = findDocxTocRange(live.state.doc as unknown as DocxTocDocNode);
  if (!range) return { outcome: "missing", entries: 0 };
  const nodes = tocNodes(live, options);
  if (!nodes) return { outcome: "empty", entries: 0 };
  const tr = live.state.tr.replaceWith(
    range.from,
    range.to,
    nodes.map((node) => live.schema.nodeFromJSON(node)),
  );
  live.view.dispatch(tr);
  return { outcome: "updated", entries: nodes.length };
}

/** Insert a caption paragraph at the caret; the label's next number is counted
 * from the live document (parsed captions included). */
export function insertDocxCaption(editor: Editor | null, label: string, text: string): boolean {
  const live = editable(editor);
  if (!live) return false;
  const number = countDocxCaptions(live.state.doc as unknown as DocxTocDocNode, label) + 1;
  const content = docxCaptionContent(label, number, text);
  return live.chain().focus().insertContent({ type: "docParagraph", attrs: { docxIndex: null }, content }).run();
}

/** Insert the bracketed reference text at the caret (basic citation). */
export function insertDocxCitation(editor: Editor | null, author: string, year: string): boolean {
  const live = editable(editor);
  if (!live) return false;
  const text = docxCitationText(author, year);
  if (!text) return false;
  return live.chain().focus().insertContent({ type: "text", text }).run();
}
