"use client";

// B7 (UNI-924): the TOC/caption model shared by the editor actions and their
// tests. Pure functions over a ProseMirror-shaped document — no editor, no
// React — so the field layout can be pinned without a live surface.
//
// The editor is the source of truth for save: an inserted TOC is a run of
// docProtected nodes carrying `fieldDisplay` (what renderFieldSpec draws) and
// `genXml` (the w:p fragment the vendored save plan emits verbatim), exactly
// the shape a parsed TOC already has. Update replaces that run with freshly
// generated nodes; a parse-loaded TOC is therefore refreshable too.
import type { JSONContent } from "@tiptap/core";
import { docxCaptionInstr, docxCaptionLabel, isDocxCaptionInstr, type DocxTocLine } from "@uniwork/office-engine/docx";

/** Word's label the vendored field parser writes for a TOC paragraph
 * (`fieldLabel`): a parse-loaded TOC's boundary nodes carry it, and the
 * generated entry nodes reuse it so a range scan finds either origin. */
export const DOCX_TOC_FIELD_LABEL = "Auto TOC (updates when opened in Word)";

/** The vendored parser's label for a lone field-end paragraph. */
export const DOCX_TOC_END_LABEL = "Field end marker";

/** …and its variant that also carries a page break. */
export const DOCX_TOC_END_BREAK_LABEL = DOCX_TOC_END_LABEL + " + page break";

/** Level selector the dialog offers; the engine accepts 1-9. */
export const DOCX_TOC_MAX_UI_LEVEL = 3;

export interface DocxTocHeading {
  level: number;
  text: string;
  anchor?: string;
}

export interface DocxTocFieldOptions {
  maxLevel: number;
  pageNumbers: boolean;
  hyperlinks: boolean;
}

/** The structural slice of a ProseMirror node these helpers read; TipTap's
 * `editor.state.doc` satisfies it. */
export interface DocxTocDocNode {
  readonly type: { readonly name: string };
  readonly textContent: string;
  readonly attrs?: Readonly<Record<string, unknown>> | undefined;
  readonly nodeSize: number;
  forEach(callback: (node: DocxTocDocNode, offset: number) => void): void;
  descendants(callback: (node: DocxTocInlineNode) => void): void;
}

interface DocxTocInlineNode {
  readonly marks?: ReadonlyArray<{ readonly type: { readonly name: string }; readonly attrs?: Readonly<Record<string, unknown>> }> | undefined;
}

function levelOf(node: DocxTocDocNode): number {
  const raw = Number(node.attrs?.level ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(9, Math.max(1, Math.round(raw)));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** The bookmark a TOC hyperlink should target: Word's own `_Toc…` anchors
 * live in hiddenBookmarks; a user bookmark is the fallback. */
function anchorOf(node: DocxTocDocNode): string | undefined {
  return [...stringList(node.attrs?.hiddenBookmarks), ...stringList(node.attrs?.bookmarks)][0];
}

/** The document's headings in order, up to `maxLevel` — the TOC entry source.
 * `_Toc` bookmarks ride along as hyperlink anchors when the heading has one. */
export function readDocxTocHeadings(doc: DocxTocDocNode | null | undefined, maxLevel: number): DocxTocHeading[] {
  const raw = Number(maxLevel);
  const limit = Number.isFinite(raw) ? Math.min(9, Math.max(1, Math.round(raw))) : DOCX_TOC_MAX_UI_LEVEL;
  const headings: DocxTocHeading[] = [];
  if (!doc) return headings;
  doc.forEach((node) => {
    if (node.type.name !== "docHeading") return;
    const level = levelOf(node);
    if (level > limit) return;
    const text = node.textContent.trim();
    if (!text) return;
    const anchor = anchorOf(node);
    headings.push({ level, text, ...(anchor ? { anchor } : {}) });
  });
  return headings;
}

/** The document order index of the first top-level node a TOC range starts at,
 * and the position/size needed to replace it. A parse-loaded TOC can carry a
 * lone field-end paragraph after its entries; a run in progress absorbs it. */
export interface DocxTocRange {
  from: number;
  to: number;
  /** Top-level child index of the first TOC node (tests/debugging). */
  childIndex: number;
  /** the absorbed field-end paragraph carried a page break */
  pageBreak: boolean;
}

function fieldKindOf(node: DocxTocDocNode): unknown {
  return (node.attrs?.fieldDisplay as { kind?: unknown } | undefined)?.kind;
}

function isTocEntryNode(node: DocxTocDocNode): boolean {
  return node.type.name === "docProtected" && fieldKindOf(node) === "tocLine";
}

function isTocBoundaryNode(node: DocxTocDocNode): boolean {
  return node.type.name === "docProtected" && String(node.attrs?.label ?? "") === DOCX_TOC_FIELD_LABEL;
}

/** Word leaves a lone field-end paragraph (often with a page break) after a
 * TOC's entries; the parser labels both variants "Field end marker…". */
function isTocEndNode(node: DocxTocDocNode): boolean {
  return node.type.name === "docProtected" && String(node.attrs?.label ?? "").startsWith(DOCX_TOC_END_LABEL);
}

/** True when the absorbed field-end paragraph carried a page break: the
 * parser's label says so, and a generated node's own XML is checked too. */
function endNodeHasPageBreak(node: DocxTocDocNode): boolean {
  if (String(node.attrs?.label ?? "") === DOCX_TOC_END_BREAK_LABEL) return true;
  const genXml = node.attrs?.genXml;
  return typeof genXml === "string" && genXml.includes('w:type="page"');
}

/** The first contiguous top-level TOC node run, or null when the document has
 * none. The run ends at the first other node; a later TOC is not swallowed. */
export function findDocxTocRange(doc: DocxTocDocNode | null | undefined): DocxTocRange | null {
  if (!doc) return null;
  let from = -1;
  let to = -1;
  let childIndex = -1;
  let pageBreak = false;
  let index = 0;
  let closed = false;
  doc.forEach((node, offset) => {
    if (closed) return;
    const started = from >= 0;
    const toc = isTocEntryNode(node) || isTocBoundaryNode(node) || (started && isTocEndNode(node));
    if (toc) {
      if (!started) {
        from = offset;
        childIndex = index;
      }
      to = offset + node.nodeSize;
      if (started && isTocEndNode(node) && endNodeHasPageBreak(node)) pageBreak = true;
    } else if (started) {
      closed = true;
    }
    index += 1;
  });
  return from >= 0 ? { from, to, childIndex, pageBreak } : null;
}

/** The JSONContent nodes one built TOC line becomes in the editor: the field
 * XML rides `genXml`, the display fields mirror what the vendored parser
 * (`fieldDisplayOf`) derives from the same XML. */
export function tocNodesForLines(lines: readonly DocxTocLine[]): JSONContent[] {
  return lines.map((line) => ({
    type: "docProtected",
    attrs: {
      docxIndex: null,
      blockType: "passthrough",
      label: DOCX_TOC_FIELD_LABEL,
      previewText: "",
      styleId: `TOC${line.level}`,
      fieldDisplay: {
        kind: "tocLine",
        left: line.left,
        right: line.right ?? "",
        level: line.level,
        ...(line.anchor ? { anchor: line.anchor } : {}),
      },
      genXml: line.xml,
    },
  }));
}

/** One generated paragraph carrying the page break a Word-authored TOC leaves
 * after its field-end marker: an update absorbs that paragraph, and this keeps
 * the break so the first body paragraph does not pull up a page. */
export function tocPageBreakNode(): JSONContent {
  return {
    type: "docProtected",
    attrs: {
      docxIndex: null,
      blockType: "passthrough",
      label: DOCX_TOC_END_BREAK_LABEL,
      previewText: "",
      genXml: '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    },
  };
}

/** The inline content of a caption paragraph: `<label> <SEQ field> <text>`.
 * The number run carries the vendored inline-field mark, so the save plan
 * writes a real SEQ field (the same instruction the engine op emits). */
export function docxCaptionContent(label: string, number: number, text: string): JSONContent[] {
  const clean = docxCaptionLabel(label);
  const content: JSONContent[] = [{ type: "text", text: `${clean} ` }];
  content.push({
    type: "text",
    text: String(number),
    marks: [
      {
        type: "instrField",
        attrs: { instr: docxCaptionInstr(clean), beginXml: null, dirty: true, fieldId: null, fieldPart: null },
      },
    ],
  });
  if (text.length > 0) content.push({ type: "text", text: ` ${text}` });
  return content;
}

/** The vendored parser's label for a paragraph holding a SEQ field: a caption
 * that came from the parse is a protected block, not an editable paragraph, so
 * its SEQ instruction never reaches an inline-field mark. */
export const DOCX_CAPTION_FIELD_LABEL = "Caption number field";

/** True when a parse-loaded caption block belongs to `label`: its visible
 * field result is `<label> <number> <text>`, the shape a SEQ caption has. */
function isParsedCaptionOf(node: DocxTocDocNode, label: string): boolean {
  if (node.type.name !== "docProtected") return false;
  if (String(node.attrs?.label ?? "") !== DOCX_CAPTION_FIELD_LABEL) return false;
  const display = node.attrs?.fieldDisplay as { kind?: unknown; left?: unknown } | undefined;
  if (display?.kind !== "text" || typeof display.left !== "string") return false;
  const pattern = new RegExp("^\\s*" + docxCaptionLabel(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+\\d+(?:[\\s:.,;)\\]\\u2013\\u2014]|$)");
  return pattern.test(display.left);
}

/** How many captions of one label the live document already carries. Two shapes
 * count: an inserted caption is an editable paragraph whose number run carries
 * the inline-field mark, while a Word-authored caption survives the parse as a
 * protected "Caption number field" block whose SEQ instruction lives only in
 * the original XML. The next caption's number is this count + 1. The mark
 * matcher is the engine's, so a Word-authored instruction with extra switches
 * or stray whitespace counts exactly as the engine's own XML scan counts it. */
export function countDocxCaptions(doc: DocxTocDocNode | null | undefined, label: string): number {
  if (!doc) return 0;
  let count = 0;
  doc.descendants((node) => {
    for (const mark of node.marks ?? []) {
      if (mark.type.name !== "instrField") continue;
      if (isDocxCaptionInstr(mark.attrs?.instr, label)) count += 1;
    }
  });
  doc.forEach((node) => {
    if (isParsedCaptionOf(node, label)) count += 1;
  });
  return count;
}

/** The bracketed reference a basic citation inserts: "(Author, Year)". */
export function docxCitationText(author: string, year: string): string | null {
  const name = author.trim();
  const date = year.trim();
  if (name.length === 0 && date.length === 0) return null;
  return name.length > 0 && date.length > 0 ? `(${name}, ${date})` : `(${name || date})`;
}
