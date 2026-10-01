// DocxParsed.blocks <-> ProseMirror doc conversion. The only two directions
// a save needs: build the initial editable doc from the engine's blocks, and
// read back the user's edits as the desired final block order
// (docx-reconcile.ts turns that into the G2 engine's DocxEdit ops).
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { DocxBlock, DocxGeneratedBlock, DocxRun } from "@uniwork/office-engine/docx";
import type { DocxBlockAttrs, DocxBlockKind, DocxBlockList } from "./docx-schema";

function runsToInline(runs: DocxRun[] | undefined): JSONContent[] {
  const out: JSONContent[] = [];
  for (const run of runs ?? []) {
    if (!run.text) continue;
    const marks: NonNullable<JSONContent["marks"]> = [];
    if (run.bold) marks.push({ type: "bold" });
    if (run.italic) marks.push({ type: "italic" });
    if (run.underline) marks.push({ type: "underline" });
    out.push({ type: "text", text: run.text, ...(marks.length ? { marks } : {}) });
  }
  return out;
}

/** Reads a top-level docxBlock node's inline content back into engine runs. */
export function inlineToRuns(node: PMNode): DocxRun[] {
  const runs: DocxRun[] = [];
  node.forEach((child) => {
    if (!child.isText || !child.text) return;
    const run: DocxRun = { text: child.text };
    if (child.marks.some((m) => m.type.name === "bold")) run.bold = true;
    if (child.marks.some((m) => m.type.name === "italic")) run.italic = true;
    if (child.marks.some((m) => m.type.name === "underline")) run.underline = true;
    runs.push(run);
  });
  return runs;
}

export function runsHaveText(runs: DocxRun[]): boolean {
  return runs.some((r) => r.text.length > 0);
}

export function runsEqual(a: DocxRun[], b: DocxRun[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((run, i) => {
    const other = b[i];
    return other !== undefined && run.text === other.text && !!run.bold === !!other.bold && !!run.italic === !!other.italic && !!run.underline === !!other.underline;
  });
}

export function listsEqual(a: DocxBlockList | null, b: DocxBlockList | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.numId === b.numId && a.ilvl === b.ilvl;
}

/** The visual kind an engine block renders as. Original "paragraph" blocks
 * are the only ones `set_paragraph_text` may touch in place (model.ts
 * requireParagraphTarget); "heading"/"listItem"/anything else are
 * read/insert-only at this engine version (model.ts's own comment: "stay
 * inventoried but are never silently retyped"). */
export function kindOf(block: DocxBlock): { blockKind: DocxBlockKind; level: number | null; list: DocxBlockList | null } {
  if (block.type === "heading") {
    const level = typeof block.level === "number" ? block.level : 1;
    return { blockKind: "heading", level, list: null };
  }
  if (block.type === "listItem") {
    const list = (block.list as DocxBlockList | undefined) ?? { kind: "bullet", numId: "0", ilvl: 0 };
    return { blockKind: "listItem", level: null, list };
  }
  if (block.type === "paragraph") return { blockKind: "paragraph", level: null, list: null };
  return { blockKind: "other", level: null, list: null };
}

function emptyParagraphNode(): JSONContent {
  const attrs: DocxBlockAttrs = { docxIndex: null, originalType: null, blockKind: "paragraph", level: null, list: null, placeholderLabel: null };
  return { type: "docxBlock", attrs };
}

/** Builds the initial editable document from the engine's current blocks
 * (adapter.blocksOf(ref)) — visible blocks only, in document order. */
export function blocksToDoc(blocks: DocxBlock[]): JSONContent {
  const visible = blocks.filter((b) => !b.hidden && b.docxIndex !== null);
  const content: JSONContent[] = visible.map((block) => {
    const { blockKind, level, list } = kindOf(block);
    const attrs: DocxBlockAttrs = {
      docxIndex: block.docxIndex,
      originalType: block.type,
      blockKind,
      level,
      list,
      placeholderLabel: blockKind === "other" ? `[${block.type}]` : null,
    };
    return { type: "docxBlock", attrs, content: blockKind === "other" ? undefined : runsToInline(block.runs) };
  });
  return { type: "doc", content: content.length ? content : [emptyParagraphNode()] };
}

export function buildGeneratedBlock(attrs: DocxBlockAttrs, runs: DocxRun[]): DocxGeneratedBlock {
  if (attrs.blockKind === "heading") return { type: "heading", level: attrs.level ?? 1, runs };
  if (attrs.blockKind === "listItem") return { type: "listItem", list: attrs.list ?? { kind: "bullet", numId: "0", ilvl: 0 }, runs };
  return { type: "paragraph", runs };
}

export type DesiredItem =
  /** Keep the original block exactly as the plan already has it. */
  | { kind: "passthrough"; docxIndex: number }
  /** Original engine type "paragraph", still a paragraph, text changed. */
  | { kind: "text-edit"; docxIndex: number; runs: DocxRun[] }
  /** Any other change to an existing block: style changed away from plain
   * paragraph, or the original type never supported in-place text edits. */
  | { kind: "restyle"; docxIndex: number; block: DocxGeneratedBlock }
  /** A block with no backing docxIndex yet. */
  | { kind: "insert"; block: DocxGeneratedBlock };

/** Walks the current document and decides, per top-level block, what the
 * engine op should be — docx-reconcile.ts turns this into actual DocxEdit
 * calls against the adapter's live plan. "other" (table/image/passthrough,
 * phase 3's read-only renderer) is never touched here: its node view is
 * not content-editable, so it always passes through unchanged. */
export function computeDesiredList(doc: PMNode, blocksByIndex: Map<number, DocxBlock>): DesiredItem[] {
  const out: DesiredItem[] = [];
  doc.forEach((node) => {
    const attrs = node.attrs as DocxBlockAttrs;
    if (attrs.blockKind === "other") {
      if (attrs.docxIndex !== null) out.push({ kind: "passthrough", docxIndex: attrs.docxIndex });
      return;
    }
    const runs = inlineToRuns(node);
    if (attrs.docxIndex === null) {
      if (runsHaveText(runs)) out.push({ kind: "insert", block: buildGeneratedBlock(attrs, runs) });
      return; // an empty new block has nothing to save — simply not emitted
    }
    const original = blocksByIndex.get(attrs.docxIndex);
    if (!original) {
      // Shouldn't happen (every live node's docxIndex came from an open
      // blocksOf() snapshot), but an unknown index can never be an original
      // passthrough — treat it as a fresh insert instead of crashing.
      if (runsHaveText(runs)) out.push({ kind: "insert", block: buildGeneratedBlock(attrs, runs) });
      return;
    }
    if (!runsHaveText(runs)) return; // emptied out: dropped, same as a delete
    const originalKind = kindOf(original);
    const stillPlainParagraph = attrs.originalType === "paragraph" && attrs.blockKind === "paragraph";
    if (stillPlainParagraph) {
      if (runsEqual(runs, original.runs ?? [])) out.push({ kind: "passthrough", docxIndex: attrs.docxIndex });
      else out.push({ kind: "text-edit", docxIndex: attrs.docxIndex, runs });
      return;
    }
    const unchanged = originalKind.blockKind === attrs.blockKind
      && originalKind.level === attrs.level
      && listsEqual(originalKind.list, attrs.list)
      && runsEqual(runs, original.runs ?? []);
    if (unchanged) out.push({ kind: "passthrough", docxIndex: attrs.docxIndex });
    else out.push({ kind: "restyle", docxIndex: attrs.docxIndex, block: buildGeneratedBlock(attrs, runs) });
  });
  return out;
}
