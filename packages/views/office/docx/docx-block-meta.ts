"use client";

// G3-04d R2 (UNI-823): parse-layer pagination semantics for the DOCX driver.
// Upstream genoffice builds this lookup in its App (blockMetaOf,
// App.tsx:2836-2879) and reads the table cut from the DOM (3704-3763); the
// UniWork pagination driver is the App here, so the metadata + the cut/row
// resolution live in this module. Without them the slicer knows no row is
// unsplittable and no w:tblHeader table repeats header rows, so a page break
// lands inside a row (G3-D3 docx-long-table: 61/183 rows/cells vs 65/191).
import { tableRowFlags, type RendererBlockMeta } from "@uniwork/office-upstream/docs-renderer-editor";

/** The parse-layer paragraph constraints the slicer consumes (upstream BlockMeta). */
interface DocxParseDisplay {
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
  suppressLineNumbers?: boolean;
}

interface DocxParseStyle {
  type?: string;
  isDefault?: boolean;
  display?: DocxParseDisplay;
}

interface DocxParseBlock {
  type?: string;
  docxIndex?: number;
  styleId?: string;
  originalXml?: string;
  format?: DocxParseDisplay;
}

/**
 * docxIndex -> parse-layer pagination semantics — upstream App's `blockMetaOf`.
 * Tables with `tblHeader` / `cantSplit` / a non-exact `w:trHeight` carry their
 * per-row flags; paragraphs carry the effective keepNext / keepLines /
 * pageBreakBefore / widowControl of their block format and paragraph style.
 */
export function docxBlockMeta(parsed: unknown): (docxIndex: number) => RendererBlockMeta | undefined {
  const doc = parsed as {
    blocks?: DocxParseBlock[];
    styles?: Map<string, DocxParseStyle>;
    compatibilityMode?: number;
  };
  const blocks = doc.blocks ?? [];
  const styles = doc.styles instanceof Map ? doc.styles : new Map<string, DocxParseStyle>();
  const defaultParaStyle = [...styles.values()].find((s) => s.type === "paragraph" && s.isDefault);
  const metaCache = new Map<number, RendererBlockMeta | undefined>();
  return (docxIndex: number): RendererBlockMeta | undefined => {
    if (metaCache.has(docxIndex)) return metaCache.get(docxIndex);
    const block = blocks.find((b) => b.docxIndex === docxIndex);
    let meta: RendererBlockMeta | undefined;
    if (block) {
      if (block.type === "table") {
        const flagged = !!block.originalXml && /tblHeader|cantSplit|<w:trHeight\b/.test(block.originalXml);
        if (flagged) {
          meta = {
            tableRowFlags: tableRowFlags(block.originalXml as string),
            ...((doc.compatibilityMode ?? 0) >= 15 ? { modernTableHeaders: true } : {}),
          };
        }
      } else {
        const styleDisplay = (block.styleId ? styles.get(block.styleId)?.display : undefined) ?? defaultParaStyle?.display;
        const keepNext = block.format?.keepNext ?? styleDisplay?.keepNext;
        const keepLines = block.format?.keepLines ?? styleDisplay?.keepLines;
        const breakBefore = block.format?.pageBreakBefore ?? styleDisplay?.pageBreakBefore;
        const widowOff = (block.format?.widowControl ?? styleDisplay?.widowControl) === false;
        const noLineNo = block.format?.suppressLineNumbers ?? styleDisplay?.suppressLineNumbers;
        if (keepNext || keepLines || breakBefore || widowOff || noLineNo) {
          meta = {
            ...(keepNext ? { keepNext: true } : {}),
            ...(keepLines ? { keepLines: true } : {}),
            ...(noLineNo ? { suppressLineNumbers: true } : {}),
            ...(breakBefore ? { breakBefore: true } : {}),
            ...(widowOff ? { widowControl: false } : {}),
          };
        }
      }
    }
    metaCache.set(docxIndex, meta);
    return meta;
  };
}

/** One table row's measured top offset and the in-table gap heights above it. */
export interface DocxTableCutRowInput {
  el: Element;
  top: number;
  gapsAbove: number;
}

/**
 * Name the rows a table page cut touches — `cutRow` is the last real row
 * starting at/above the cut (the row the cut falls inside) and `nextRow` the
 * row that starts the next page (its top within 1.5px of the cut). Pure: the
 * caller supplies measured offsets.
 */
export function tableCutRow(
  rows: DocxTableCutRowInput[],
  cutOff: number,
): { cutRow: Element | null; nextRow: Element | null } {
  let cutRow: Element | null = null;
  let nextRow: Element | null = null;
  for (const row of rows) {
    const offset = row.top - row.gapsAbove;
    if (Math.abs(offset - cutOff) < 1.5) {
      nextRow = row.el;
      break;
    }
    if (offset <= cutOff + 0.5) cutRow = row.el;
  }
  return { cutRow, nextRow };
}

/** The rows of a cut-in-table boundary with their measured offsets. */
export function resolveTableCut(
  el: Element,
  cutOff: number,
  factor: number,
): { cutRow: Element | null; nextRow: Element | null } {
  const gapRects = Array.from(el.querySelectorAll(".page-gap-inline")).map((g) => g.getBoundingClientRect());
  const elTop = el.getBoundingClientRect().top;
  const rows = Array.from(el.querySelectorAll("tr"))
    .filter(
      (tr) =>
        !tr.closest(".doc-nested-table") &&
        !tr.classList.contains("page-gap") &&
        !tr.classList.contains("page-gap-cut") &&
        !tr.classList.contains("page-repeat-header"),
    )
    .map((tr) => {
      const top = tr.getBoundingClientRect().top;
      const gapsAbove = gapRects.reduce((sum, g) => (g.top <= top ? sum + g.height : sum), 0);
      return { el: tr, top: (top - elTop) / factor, gapsAbove: gapsAbove / factor };
    });
  return tableCutRow(rows, cutOff);
}

/** The table's real column grid: the widest row's colSpan sum, ignoring the
 *  paginator's own gap rows and repeated-header clones (a wider spanning cell
 *  would add phantom columns and collapse every real cell to ~1px). */
export function tableGridCols(row: Element): number {
  const table = row.closest("table");
  const rows = table ? Array.from(table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr")) : [];
  return Math.max(
    1,
    ...rows
      .filter((r) => !r.classList.contains("page-gap") && !r.classList.contains("page-repeat-header"))
      .map((r) => Array.from(r.cells).reduce((sum, cell) => sum + cell.colSpan, 0)),
  );
}

/** w:tblHeader clones replacing the height the slicer reserved at the top of
 *  the continuation page (upstream App clones the source header rows below the
 *  table gap, accumulating their height up to the reserved one). */
export function repeatHeaderClones(row: Element, reservedHeightPx: number, factor: number): HTMLElement[] | null {
  const table = row.closest("table");
  if (!table) return null;
  const sourceRows = Array.from(table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr")).filter(
    (r) => !r.classList.contains("page-gap") && !r.classList.contains("page-repeat-header"),
  );
  const els: HTMLElement[] = [];
  let acc = 0;
  for (const source of sourceRows) {
    if (acc >= reservedHeightPx - 1.5) break;
    const clone = source.cloneNode(true) as HTMLElement;
    clone.classList.add("page-gap-inline", "page-repeat-header");
    clone.setAttribute("contenteditable", "false");
    els.push(clone);
    acc += source.getBoundingClientRect().height / factor;
  }
  return els.length > 0 ? els : null;
}

/** The ProseMirror position just before the docTableRow node containing `row`. */
export function posBeforeTableRow(view: DocxFrameView, row: Element): number | undefined {
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(row, 0));
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === "docTableRow") return $pos.before(depth);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** The minimal editor-view surface the frame builder reads (jsdom drives it). */
export interface DocxFrameResolvedPos {
  depth: number;
  before(depth: number): number;
  node(depth: number): { type: { name: string } };
}
export interface DocxFrameView {
  posAtDOM(node: Node, offset: number): number;
  state: { doc: { resolve(pos: number): DocxFrameResolvedPos } };
}
