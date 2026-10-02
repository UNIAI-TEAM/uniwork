"use client";

// G3-04d (UNI-823): the page-turn layer of the DOCX pagination driver —
// header/footer pieces, the gap builder (block / inline / in-table with the
// w:tblHeader clones), the paper min-height that makes the last page a full
// sheet, and the per-section strip heights. Upstream genoffice owns these in
// its App.tsx loop; UniWork's driver (./docx-pagination) calls them.

import type { EditorView } from "@tiptap/pm/view";
import {
  GAP_BAND,
  assignSections,
  columnLayoutSpecs,
  effectiveBottomPx,
  effectiveHfRefs,
  effectiveTopPx,
  formatPageNumber,
  hfHasVisibleContent,
  hfReservedHeightPx,
  hfStripGeom,
  hfVariantOf,
  lineStartAnchor,
  makeGapHfEl,
  nextLineAnchor,
  pageNumbers,
  sectionFirstPages,
  sectionPageBox,
  setColumnLayout,
  setPageGaps,
  setRowFills,
  visiblePageCount,
  type RendererBlockBox,
  type RendererHeaderFooter,
  type RendererHfParagraph,
  type RendererHfPart,
  type RendererPageGapSpec,
  type RendererPageSlice,
  type RendererSection,
  type RendererSectionHfHeights,
} from "@uniwork/office-upstream/docs-renderer-editor";
import { docxColumnMode } from "./docx-columns";
import {
  posBeforeTableRow,
  repeatHeaderClones,
  resolveTableCut,
  tableGridCols,
  type DocxFrameView,
} from "./docx-block-meta";

const TWIPS_TO_PX = 96 / 1440;

const twipsToPx = (twips: number): number => twips * TWIPS_TO_PX;


/** A resolved header/footer slot: the parts the strip builders need. */
export interface HfPiece {
  value: RendererHeaderFooter | null;
  images?: unknown[];
}

/** The pagination inputs built from the engine parse (see createDocxPaginationSpec). */
export interface DocxPaginationSpec {
  /** `readSections(parsed)` of the opened document. */
  sections: RendererSection[];
  /** Header/footer variants from the parse (`word/header*.xml` parts). */
  hfParts: Record<string, RendererHfPart> | undefined;
  evenAndOddHeaders: boolean;
  /** Document-level header/footer, the final section's fallback. */
  defaultHeader: RendererHeaderFooter | null;
  defaultFooter: RendererHeaderFooter | null;
  /** The engine parse handle (R2 block metadata / T document styles). */
  parsedDoc?: unknown;
}

/** The parse's header/footer part (`HfPartInfo` shape) as a strip value. */
function hfFromPart(part: RendererHfPart | null | undefined): RendererHeaderFooter | null {
  if (!part) return null;
  if (!part.text && !part.hasPageNumber && (part.paras ?? []).length === 0 && !part.images?.length) return null;
  return {
    text: part.text,
    ...(part.hasPageNumber ? { pageNumber: true } : {}),
    ...((part.paras ?? []).length > 0 ? { paras: part.paras } : {}),
  };
}

/** The parse's document-level header/footer fields (`headerText`/`headerParas`…). */
export function documentHeaderFooter(text: unknown, paras: unknown, hasPageNumber: unknown): RendererHeaderFooter | null {
  const value: RendererHeaderFooter = {
    text: typeof text === "string" ? text : "",
    ...(hasPageNumber === true ? { pageNumber: true } : {}),
    ...(Array.isArray(paras) && paras.length > 0 ? { paras: paras as RendererHfParagraph[] } : {}),
  };
  const empty = value.text.trim() === "" && value.pageNumber !== true && (value.paras?.length ?? 0) === 0;
  return empty ? null : value;
}

/** Resolve a page's header/footer: titlePg first page, even/odd, refs, default. */
export function resolvePageHf(
  spec: DocxPaginationSpec,
  sectionIndex: number,
  kind: "header" | "footer",
  variant: "default" | "first" | "even",
  isFinalSection: boolean,
): HfPiece {
  const refs = effectiveHfRefs(spec.sections)[Math.min(sectionIndex, Math.max(spec.sections.length - 1, 0))];
  const rId = refs?.[kind]?.[variant] ?? refs?.[kind]?.default;
  const part = rId ? spec.hfParts?.[rId] : undefined;
  const value = hfFromPart(part);
  if (value) return { value, images: part?.images };
  if (isFinalSection) return { value: kind === "header" ? spec.defaultHeader : spec.defaultFooter };
  return { value: null };
}

export const hfPieceKey = (piece: HfPiece): string =>
  piece.value
    ? `${piece.value.text}|${piece.value.pageNumber ? 1 : 0}|${piece.value.paras?.length ?? 0}|img${piece.images?.length ?? 0}`
    : "";

/** Strip geometry baked into the widgets (D-05): a margin/headerDist change with
 *  identical text must rebuild the strips, or the old inset survives. */
export const stripGeomKey = (settings: RendererSection["settings"]): string =>
  `${settings.pageWidth}:${settings.pageHeight}:${settings.marginTop}:${settings.marginBottom}:${settings.marginLeft}:${settings.marginRight}:${settings.headerDist ?? ""}:${settings.footerDist ?? ""}`;

/** Footer of one page and header of the next ride the gap between them. */
function buildGapHfEls(
  spec: DocxPaginationSpec,
  footer: HfPiece,
  header: HfPiece,
  pageNoOf: (index: number) => string,
  footerPageIndex: number,
  headerPageIndex: number,
  pageTotal: number,
  prevSettings: RendererSection["settings"],
  nextSettings: RendererSection["settings"],
  metrics: { marginTop: number },
): HTMLElement[] {
  const els: HTMLElement[] = [];
  const canvasPaperW = sectionPageBox(spec.sections[0]?.settings ?? nextSettings).width;
  const addStrip = (
    kind: "header" | "footer",
    piece: HfPiece,
    settings: RendererSection["settings"],
    pageNo: string,
  ) => {
    if (!piece.value || !hfHasVisibleContent(piece.value, piece.images)) return;
    const box = sectionPageBox(settings);
    const el = makeGapHfEl({
      kind,
      value: piece.value,
      images: piece.images,
      pageNo,
      pageTotal,
      geom: hfStripGeom(settings),
    });
    el.style.width = `${Math.min(box.contentWidth, canvasPaperW)}px`;
    if (kind === "footer") {
      el.style.top = "auto";
      el.style.bottom = `${GAP_BAND + metrics.marginTop + box.footerDist}px`;
    } else {
      const headerStripTop = Math.min(box.headerDist, metrics.marginTop);
      el.style.bottom = "auto";
      el.style.top = `calc(100% - ${metrics.marginTop - headerStripTop}px)`;
    }
    els.push(el);
  };
  addStrip("footer", footer, prevSettings, pageNoOf(footerPageIndex));
  addStrip("header", header, nextSettings, pageNoOf(headerPageIndex));
  return els;
}

function posFromAnchor(view: { posAtDOM(node: Node, offset: number): number }, anchor: { node: Text | Element; charOffset: number }): number | undefined {
  try {
    if (anchor.node instanceof Element) {
      const parent = anchor.node.parentNode;
      if (!parent) return undefined;
      return view.posAtDOM(parent, Array.prototype.indexOf.call(parent.childNodes, anchor.node));
    }
    return view.posAtDOM(anchor.node, Math.min(anchor.charOffset, anchor.node.length));
  } catch {
    return undefined;
  }
}

/** One edge strip: its piece, the section geometry it paints against, its page number. */
export interface PaginationEdgeHfStrip {
  piece: HfPiece;
  settings: RendererSection["settings"];
  pageNo: string;
}

/**
 * The wrap-edge strips (visual r1 / D-01): the top edge is page 1's header, the
 * bottom edge is the LAST page's footer — `.page-hf-footer` anchors to the
 * wrap bottom, which is the last page's paper bottom, and no gap exists below
 * the last page.
 */
export interface PaginationEdgeHf {
  header: PaginationEdgeHfStrip;
  footer: PaginationEdgeHfStrip;
  pageTotal: number;
}

/** The page turn map: gaps (with their per-page HF strips) and the page count. */
export interface PaginationFrame {
  pages: number;
  nums: number[];
  edgeHf: PaginationEdgeHf | null;
  gaps: RendererPageGapSpec[];
}

/**
 * Build the page-turn frame from the measured flow and its slices: one gap per
 * page boundary carrying the previous page's footer and the next page's header
 * (inline gaps for line-level cuts, in-table gaps for cuts inside a table),
 * plus the first page's strips (no gap widget sits above page 1). Pure apart
 * from the optional view used to resolve cut positions — jsdom tests drive it
 * directly.
 */
export function buildPaginationFrame(input: {
  spec: DocxPaginationSpec;
  live: RendererSection[];
  blocks: RendererBlockBox[];
  hfHeights: RendererSectionHfHeights[];
  slices: RendererPageSlice[];
  view?: DocxFrameView;
  zoomFactor?: number;
}): PaginationFrame {
  const { spec, live, blocks, hfHeights, slices, view } = input;
  const factor = input.zoomFactor ?? 1;
  const colMode = docxColumnMode(live);
  const pages = visiblePageCount(slices);
  const nums = pageNumbers(slices, live);
  const firsts = sectionFirstPages(slices);
  const sectionIndexOf = (index: number): number => {
    const item = slices[index];
    return item ? Math.min(item.section, live.length - 1) : 0;
  };
  const pageNoTextOf = (index: number) => formatPageNumber(nums[index] ?? index + 1, live[sectionIndexOf(index)]?.pageNumberFmt);
  const pieceOf = (index: number, kind: "header" | "footer"): HfPiece => {
    const sectionIdx = sectionIndexOf(index);
    const section = live[sectionIdx];
    const variant = hfVariantOf(section?.titlePg, firsts[index] === true, spec.evenAndOddHeaders, nums[index] ?? index + 1);
    return resolvePageHf(spec, sectionIdx, kind, variant, sectionIdx === live.length - 1);
  };

  const firstSection = live[sectionIndexOf(0)];
  const lastIndex = slices.length - 1;
  const lastSection = live[sectionIndexOf(lastIndex)];
  const edgeHf: PaginationEdgeHf | null = firstSection && lastSection
    ? {
        header: { piece: pieceOf(0, "header"), settings: firstSection.settings, pageNo: pageNoTextOf(0) },
        footer: { piece: pieceOf(lastIndex, "footer"), settings: lastSection.settings, pageNo: pageNoTextOf(lastIndex) },
        pageTotal: pages,
      }
    : null;

  const gaps: RendererPageGapSpec[] = [];
  for (let k = 0; k + 1 < slices.length; k += 1) {
    const slice = slices[k + 1];
    const prevSlice = slices[k];
    if (!slice || !prevSlice) continue;
    const prevSec = live[Math.min(prevSlice.section, live.length - 1)];
    const nextSec = live[Math.min(slice.section, live.length - 1)];
    if (!prevSec || !nextSec) continue;
    const hfOf = (index: number): RendererSectionHfHeights => {
      const h = hfHeights[Math.min(slices[index]?.section ?? 0, hfHeights.length - 1)] ?? { headerPx: 0, footerPx: 0 };
      return firsts[index] === true
        ? { headerPx: h.firstHeaderPx ?? h.headerPx, footerPx: h.firstFooterPx ?? h.footerPx }
        : h;
    };
    const metrics = {
      marginTop: effectiveTopPx(nextSec.settings, hfOf(k + 1).headerPx),
      marginBottom: effectiveBottomPx(prevSec.settings, hfOf(k).footerPx),
      marginLeft: twipsToPx(nextSec.settings.marginLeft),
      marginRight: twipsToPx(nextSec.settings.marginRight),
      sectionMarginLeft: twipsToPx(nextSec.settings.marginLeft),
      sectionMarginRight: twipsToPx(nextSec.settings.marginRight),
      sectionMarginTop: twipsToPx(nextSec.settings.marginTop),
    };
    const hfEls = buildGapHfEls(spec, pieceOf(k, "footer"), pieceOf(k + 1, "header"), pageNoTextOf, k, k + 1, pages, prevSec.settings, nextSec.settings, metrics);
    const hfKey = `${pageNoTextOf(k)}·${pageNoTextOf(k + 1)}·${pages}·${hfPieceKey(pieceOf(k, "footer"))}·${hfPieceKey(pieceOf(k + 1, "header"))}·${stripGeomKey(prevSec.settings)}:${stripGeomKey(nextSec.settings)}`;
    // R3: a page that ended early (explicit break / section break / keepNext)
    // leaves unused content height; upstream pads the gap's marginBottom by the
    // shortfall so the canvas paints the full paper height and the next page's
    // strips sit on it. Uniform multi-column pages skip both (the browser
    // compresses the flow); mixed-column pages use the engine's physical height
    // and pull the gap up over the vacated stacked space instead.
    const prevContentH = twipsToPx(prevSec.settings.pageHeight) - effectiveTopPx(prevSec.settings, hfOf(k).headerPx) - metrics.marginBottom;
    const used = prevSlice.end - prevSlice.start + (prevSlice.repeatHeader?.height ?? 0);
    const hasRegions = Array.isArray(prevSlice.regions) && prevSlice.regions.length > 0;
    const physUsed = hasRegions ? (colMode === "mixed" ? prevSlice.physHeight ?? used : null) : used;
    const remaining = physUsed === null ? 0 : Math.max(0, prevContentH - physUsed);
    const pullUp = physUsed === null ? 0 : Math.max(0, used - physUsed);
    const pad = Math.max(0, Math.round(remaining));
    const gapMetrics = pad > 0 ? { ...metrics, marginBottom: metrics.marginBottom + pad } : metrics;
    const shared = {
      boundaryY: slice.start,
      metrics: gapMetrics,
      ...(pullUp > 0.5 ? { pullUp } : {}),
      ...(hfEls.length > 0 ? { hfEls, hfKey } : {}),
    };
    const exact = blocks.findIndex((block) => block.el && Math.abs(block.top - slice.start) < 0.5);
    const exactBlock = exact >= 0 ? blocks[exact] : undefined;
    if (exactBlock?.el) {
      gaps.push({
        el: exactBlock.el,
        ...shared,
        ...(exactBlock.breakBefore || (exact > 0 && blocks[exact - 1]?.breakAfter) ? { suppressLeadMt: true } : {}),
      });
      continue;
    }
    const crossing = blocks.find((block) => block.el && block.top < slice.start && slice.start < block.top + block.height - 0.5);
    // R2: a cut inside a table becomes an in-table gap before the next page's
    // first row, carrying the table's real grid (and the tblHeader clones when
    // the slicer reserved their height) — instead of an inline widget inside a
    // cell, which split the row visually (G3-D3 long-table).
    if (crossing?.el && crossing.el.querySelector("tr")) {
      const cutOff = slice.start - crossing.top - ((crossing as { spaceBeforePx?: number }).spaceBeforePx ?? 0);
      const { cutRow, nextRow } = resolveTableCut(crossing.el, cutOff, factor);
      const row = nextRow ?? cutRow;
      const pos = row && view ? posBeforeTableRow(view, row) : undefined;
      if (pos !== undefined && row) {
        const reserved = slice.repeatHeader?.height;
        const repeatHeaderEls = reserved !== undefined ? repeatHeaderClones(row, reserved, factor) : null;
        gaps.push({
          pos,
          kind: "table",
          cols: tableGridCols(row),
          ...shared,
          ...(repeatHeaderEls
            ? { repeatHeaderEls, repeatHeaderKey: `${repeatHeaderEls.length}-${Math.round(reserved as number)}-${repeatHeaderEls.map((el) => el.innerHTML).join("§")}` }
            : {}),
        });
        continue;
      }
    }
    const anchor = crossing?.el ? lineStartAnchor(crossing.el, slice.start - crossing.top, factor) ?? nextLineAnchor(crossing.el, slice.start - crossing.top, factor) : null;
    const pos = anchor && view ? posFromAnchor(view, anchor) : undefined;
    if (pos !== undefined) {
      gaps.push({ pos, kind: "inline", ...shared });
      continue;
    }
    const next = blocks.find((block) => block.el && block.top >= slice.start - 0.5);
    if (next?.el) gaps.push({ el: next.el, ...shared });
  }

  return { pages, nums, edgeHf, gaps };
}

/**
 * R3: the canvas height that makes the last page a full sheet — the last gap's
 * bottom (display px) minus the top margin the page's content starts after,
 * plus the page's own height (upstream App's paperTop + pageHeight).
 */
export function docxPaperMinHeightPx(input: {
  lastGapBottom: number;
  paperTop: number;
  factor: number;
  settings: RendererSection["settings"];
  headerPx: number;
}): number {
  const paperTopCss = (input.lastGapBottom - input.paperTop) / input.factor - effectiveTopPx(input.settings, input.headerPx);
  return Math.round(paperTopCss + twipsToPx(input.settings.pageHeight));
}

/**
 * R3: extend the canvas (.doc-page) to the last page's paper bottom so the
 * final page paints as a full sheet even when its content ends early; the
 * per-gap pad covers every earlier page. Cleared for a single-page flow (the
 * sheet's own min-height already applies). Upstream App measures it from the
 * last gap element the same way.
 */
export function syncPaperMinHeight(
  pm: HTMLElement,
  slices: RendererPageSlice[],
  live: RendererSection[],
  hfHeights: RendererSectionHfHeights[],
  firsts: boolean[],
  factor: number,
): void {
  const gapEls = pm.querySelectorAll(".page-gap:not(.page-gap-carry)");
  const lastGapEl = gapEls[gapEls.length - 1];
  if (!lastGapEl || slices.length <= 1) {
    pm.style.removeProperty("min-height");
    return;
  }
  const last = slices[slices.length - 1];
  if (!last) return;
  const lastSec = live[Math.min(last.section, live.length - 1)];
  if (!lastSec) return;
  const hf = hfHeights[Math.min(last.section, hfHeights.length - 1)] ?? { headerPx: 0, footerPx: 0 };
  const headerPx = firsts[slices.length - 1] === true ? hf.firstHeaderPx ?? hf.headerPx : hf.headerPx;
  pm.style.minHeight = `${docxPaperMinHeightPx({
    lastGapBottom: lastGapEl.getBoundingClientRect().bottom,
    paperTop: pm.getBoundingClientRect().top,
    factor,
    settings: lastSec.settings,
    headerPx,
  })}px`;
}

export function resolveRowFills(
  blocks: RendererBlockBox[],
  rowSplits: unknown[] | undefined,
): Array<{ el: Element; targetPx: number; extraPx?: number }> {
  const fills: Array<{ el: Element; targetPx: number; extraPx?: number }> = [];
  for (const raw of rowSplits ?? []) {
    const patch = raw as { blockTop?: unknown; row?: unknown; targetPx?: unknown; extraPx?: unknown };
    const blockTop = patch.blockTop;
    const rowIndex = patch.row;
    const targetPx = patch.targetPx;
    if (typeof blockTop !== "number" || typeof rowIndex !== "number" || typeof targetPx !== "number") continue;
    const block = blocks.find((candidate) => (candidate as { tableRows?: unknown }).tableRows && Math.abs(candidate.top - blockTop) < 0.5);
    if (!block?.el) continue;
    const rows = Array.from(block.el.querySelectorAll("tr")).filter(
      (tr) => !tr.closest(".doc-nested-table") && !tr.classList.contains("page-gap") && !tr.classList.contains("page-repeat-header"),
    );
    const tr = rows[rowIndex];
    if (tr) fills.push({ el: tr, targetPx, ...(typeof patch.extraPx === "number" ? { extraPx: patch.extraPx } : {}) });
  }
  return fills;
}

/** Per-section HF strip heights (oversized headers squeeze the body capacity). */
export function sectionHfHeights(spec: DocxPaginationSpec, sections: RendererSection[]): RendererSectionHfHeights[] {
  const refs = effectiveHfRefs(sections);
  return sections.map((section, index) => {
    const settings = section.settings;
    const contentW = twipsToPx(settings.pageWidth - settings.marginLeft - settings.marginRight);
    const isFinal = index === sections.length - 1;
    const pick = (kind: "header" | "footer"): HfPiece => {
      const rId = refs[index]?.[kind]?.default;
      const part = rId ? spec.hfParts?.[rId] : undefined;
      const value = hfFromPart(part);
      if (value) return { value, images: part?.images };
      if (isFinal) return { value: kind === "header" ? spec.defaultHeader : spec.defaultFooter };
      return { value: null };
    };
    const first = (kind: "header" | "footer"): HfPiece => {
      if (!section.titlePg) return { value: null };
      const rId = refs[index]?.[kind]?.first;
      const part = rId ? spec.hfParts?.[rId] : undefined;
      return { value: hfFromPart(part), images: part?.images };
    };
    const header = pick("header");
    const footer = pick("footer");
    const heights: RendererSectionHfHeights = {
      headerPx: hfReservedHeightPx("header", header.value, contentW, header.images, hfStripGeom(settings)),
      footerPx: hfReservedHeightPx("footer", footer.value, contentW, footer.images),
    };
    if (section.titlePg) {
      const firstHeader = first("header");
      const firstFooter = first("footer");
      heights.firstHeaderPx = hfReservedHeightPx("header", firstHeader.value, contentW, firstHeader.images, hfStripGeom(settings));
      heights.firstFooterPx = hfReservedHeightPx("footer", firstFooter.value, contentW, firstFooter.images);
    }
    return heights;
  });
}

/**
 * Mount/refresh the wrap-edge strips inside `.page-wrap`: page 1's header on the
 * top edge and the LAST page's footer on the bottom edge (D-01 — the bottom
 * edge is the last page's paper bottom, so it carries that page's variant,
 * number and section geometry).
 */
export function mountEdgeHf(
  wrap: HTMLElement,
  header: PaginationEdgeHfStrip,
  footer: PaginationEdgeHfStrip,
  pageTotal: number,
): void {
  const host = wrap.querySelector<HTMLElement>(":scope > .docx-page-hf-host");
  if (!host) return;
  // F-1 (visual r1): the gap strips live inside the editor root and inherit the
  // document typography; the edge strips are siblings of it, so mirror the
  // editor root's computed font on the host (family + line metrics).
  const editorRoot = wrap.querySelector<HTMLElement>(".doc-page");
  if (editorRoot) {
    const computed = getComputedStyle(editorRoot);
    host.style.fontFamily = computed.fontFamily;
    host.style.lineHeight = computed.lineHeight;
  }
  host.replaceChildren();
  const add = (kind: "header" | "footer", strip: PaginationEdgeHfStrip) => {
    if (!strip.piece.value || !hfHasVisibleContent(strip.piece.value, strip.piece.images)) return;
    host.appendChild(
      makeGapHfEl({
        kind,
        value: strip.piece.value,
        images: strip.piece.images,
        pageNo: strip.pageNo,
        pageTotal,
        geom: hfStripGeom(strip.settings),
      }),
    );
  };
  add("header", header);
  add("footer", footer);
}
