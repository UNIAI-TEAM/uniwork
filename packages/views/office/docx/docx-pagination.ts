"use client";

// G3-04c T-02 (UNI-823): the pagination host for the DOCX surface.
//
// Upstream's renderer ships the measure -> slice -> gap engines but leaves the
// driver to its own App.tsx, which UniWork does not vendor — so this module is
// the App-side loop. It paints the paper geometry from the parsed section
// settings, mounts the first page's header/footer strips, and after every
// document change or resize measures the continuous flow and installs page-gap
// decorations carrying each page's footer/next header. Without it an explicit
// page break, a taller page or a different page size stays one continuous
// sheet with no headers/footers (tester finding T-02).
import type { Editor } from "@tiptap/core";
import {
  assignSections,
  bumpHfProbeFontEpoch,
  bumpLineSampleFontEpoch,
  columnLayoutSpecs,
  liveSections,
  measureBlocks,
  readSections,
  sectionFirstPages,
  sectionGeoms,
  sectionPageBox,
  setColumnLayout,
  setPageGaps,
  setRowFills,
  sliceWithLineSplit,
  type RendererHeaderFooter,
  type RendererHfPart,
  type RendererPageSlice,
  type RendererParsed,
  type RendererSection,
} from "@uniwork/office-upstream/docs-renderer-editor";
import {
  buildPaginationFrame,
  documentHeaderFooter,
  hfPieceKey,
  mountEdgeHf,
  resolveRowFills,
  sectionHfHeights,
  stripGeomKey,
  syncPaperMinHeight,
  type DocxPaginationSpec,
} from "./docx-frame";
import { colGeomsFor, docxColumnCss, docxColumnMode, docxDocumentVars, type DocxColumnMode } from "./docx-columns";
import { docxBlockMeta } from "./docx-block-meta";
import { createDocxFootnotes } from "./docx-footnotes";
// The wired zoom (view/**) scales the measured rects through the CSS `zoom`
// property; the driver must divide that scale back out of its own math.
import { docxZoomFactorOf } from "./view/zoom-controller";

// The driver's public surface, so call sites and tests keep one import path:
// the frame layer (./docx-frame), the canvas column layout (./docx-columns) and
// the parse metadata / table cut helpers (./docx-block-meta).
export {
  buildPaginationFrame,
  docxPaperMinHeightPx,
  resolvePageHf,
  type DocxPaginationSpec,
} from "./docx-frame";
export {
  colGeomsFor,
  docxColumnCss,
  docxColumnFlow,
  docxColumnMode,
} from "./docx-columns";
export { docxBlockMeta, tableCutRow } from "./docx-block-meta";

const TWIPS_TO_PX = 96 / 1440;

const twipsToPx = (twips: number): number => twips * TWIPS_TO_PX;

/** Build the pagination inputs from the engine parse (docx-engine ParsedDoc). */
export function createDocxPaginationSpec(parsed: unknown): DocxPaginationSpec {
  const doc = parsed as {
    hfParts?: Record<string, RendererHfPart>;
    evenAndOddHeaders?: unknown;
    headerText?: unknown;
    headerParas?: unknown;
    headerHasPageNumber?: unknown;
    footerText?: unknown;
    footerParas?: unknown;
    footerHasPageNumber?: unknown;
  };
  return {
    sections: readSections(parsed as RendererParsed),
    hfParts: doc.hfParts,
    evenAndOddHeaders: doc.evenAndOddHeaders === true,
    defaultHeader: documentHeaderFooter(doc.headerText, doc.headerParas, doc.headerHasPageNumber),
    defaultFooter: documentHeaderFooter(doc.footerText, doc.footerParas, doc.footerHasPageNumber),
    parsedDoc: parsed,
  };
}

function setVar(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

/** The paper CSS variables one section's settings translate to (px). */
export function docxPageGeometryVars(settings: RendererSection["settings"]): Record<string, string> {
  const page = sectionPageBox(settings);
  return {
    "--page-w": `${page.width}px`,
    "--page-h": `${page.height}px`,
    "--page-pad": `${twipsToPx(settings.marginTop)}px ${twipsToPx(settings.marginRight)}px ${twipsToPx(settings.marginBottom)}px ${twipsToPx(settings.marginLeft)}px`,
    "--header-dist": `${page.headerDist}px`,
    "--footer-dist": `${page.footerDist}px`,
    "--section-content-w": `${page.contentWidth}px`,
  };
}
interface DocxPaginator {
  refresh(): void;
  dispose(): void;
  pageCount(): number;
}

/**
 * Attach the pagination loop to a mounted editor. Returns a disposer; safe to
 * attach again after disposal (React Strict Mode replays effects).
 */
export function attachDocxPagination(editor: Editor, spec: DocxPaginationSpec): DocxPaginator {
  if (editor.isDestroyed) return { refresh: () => {}, dispose: () => {}, pageCount: () => 1 };
  let disposed = false;
  let raf = 0;
  let pages = 1;
  let gapKey = "";
  let hostKey = "";
  let colCssKey = "";
  let colStyleEl: HTMLStyleElement | null = null;
  const colMode = docxColumnMode(spec.sections);
  const columnCss = docxColumnCss(spec.sections);
  const footnotes = createDocxFootnotes(spec.parsedDoc, spec.sections);
  let blockMetaOf = docxBlockMeta(spec.parsedDoc, footnotes.bandsOf);

  /** The uniform-column CSS lives in its own style element (upstream App's
   *  colFlow block); created lazily, removed on dispose. */
  const applyColumnCss = (): void => {
    if (colCssKey === columnCss) return;
    colCssKey = columnCss;
    if (!columnCss) {
      colStyleEl?.remove();
      colStyleEl = null;
      return;
    }
    if (!colStyleEl || !colStyleEl.isConnected) {
      colStyleEl = document.createElement("style");
      colStyleEl.id = "uniwork-docx-column-flow";
      colStyleEl.dataset.uniworkDocxColumnFlow = "1";
      document.head.appendChild(colStyleEl);
    }
    colStyleEl.textContent = columnCss;
  };

  /** Single-flow measuring state (R1): a columned canvas measures and slices
   *  with the CSS columns off and the width swapped to one column, so DOM
   *  coordinates match the engine's column flow; display-state reads run
   *  outside it (upstream App's measureSingleFlow). */
  const measureSingleFlow = <T,>(pm: HTMLElement, fn: () => T): T => {
    if (colMode === "none") return fn();
    pm.classList.add("measuring-columns");
    try {
      return fn();
    } finally {
      pm.classList.remove("measuring-columns");
    }
  };

  const paginate = () => {
    const pm = editor.view.dom as HTMLElement;
    const docZoom = pm.closest(".doc-zoom") as HTMLElement | null;
    const wrap = pm.closest(".page-wrap") as HTMLElement | null;
    const canvas = spec.sections[0];
    if (!docZoom || !wrap || !canvas || editor.isDestroyed) return;

    // Paper geometry from the canvas section: the editor root (.doc-page) and
    // the .page-wrap paper both size off these variables. The document-level
    // vars (R1/T) ride the same channel.
    for (const [name, value] of Object.entries(docxPageGeometryVars(canvas.settings))) setVar(docZoom, name, value);
    for (const [name, value] of Object.entries(docxDocumentVars(spec.sections))) setVar(docZoom, name, value);
    applyColumnCss();

    const rect = pm.getBoundingClientRect();
    if (rect.width <= 0) return;

    // Read on every pass, never captured: the zoom is a view setting the
    // controller may change at any time, and this same pass re-paginates.
    const factor = docxZoomFactorOf(docZoom);
    const origin = rect.top + (parseFloat(getComputedStyle(pm).paddingTop) || 0);
    const measured = measureSingleFlow(pm, () => {
      const measuredBlocks = measureBlocks(pm, origin, factor);
      const liveBlocks = measuredBlocks.blocks;
      const liveSectionsList = liveSections(spec.sections, liveBlocks);
      if (liveSectionsList.length === 0 || liveBlocks.length === 0) return null;
      assignSections(liveBlocks, liveSectionsList);
      const hfHeightsList = sectionHfHeights(spec, liveSectionsList);
      const out: { rowSplits?: unknown[] } = {};
      // R1: geoms keep `cols` only while the canvas column layout is active.
      const geoms = colGeomsFor(sectionGeoms(liveSectionsList, hfHeightsList), colMode);
      const slices = sliceWithLineSplit(liveBlocks, geoms, measuredBlocks.totalHeight, factor, blockMetaOf, out);
      return { blocks: liveBlocks, live: liveSectionsList, hfHeights: hfHeightsList, slices, out };
    });
    if (!measured) {
      pages = 1;
      setPageGaps(editor.view, []);
      return;
    }
    const { blocks, live, hfHeights, slices, out } = measured;
    if (slices.length === 0) return;
    const frame = buildPaginationFrame({ spec, live, blocks, hfHeights, slices, view: editor.view, zoomFactor: factor, pageNotes: footnotes.pageItems(blocks, slices) });
    pages = frame.pages;
    if (frame.edgeHf) {
      const { header, footer, pageTotal } = frame.edgeHf;
      const edgeKey = `h:${header.pageNo}|${hfPieceKey(header.piece)}|${stripGeomKey(header.settings)}|f:${footer.pageNo}|${hfPieceKey(footer.piece)}|${stripGeomKey(footer.settings)}|${pageTotal}`;
      if (edgeKey !== hostKey) {
        hostKey = edgeKey;
        mountEdgeHf(wrap, header, footer, pageTotal);
      }
    }
    const nextKey = `${frame.gaps.map((gap) => gap.notesKey ?? "").join("|")}|${frame.gaps.length}|${pages}|${slices.map((s: RendererPageSlice) => `${s.start}:${s.end}:${s.section}`).join("|")}`;
    if (nextKey !== gapKey) {
      gapKey = nextKey;
      setPageGaps(editor.view, frame.gaps);
    }
    setRowFills(editor.view, resolveRowFills(blocks, out.rowSplits));
    // R3: the last page paints as a full sheet like the ones above it — extend
    // the canvas to that page's paper bottom, measured from the last gap
    // (upstream App extends .doc-page's min-height the same way).
    syncPaperMinHeight(pm, slices, live, hfHeights, sectionFirstPages(slices), factor);
    // R1 mixed mode: paint the engine's regions per block (document whose
    // sections disagree on the column spec). Uniform mode rides the CSS path.
    setColumnLayout(editor.view, colMode === "mixed" ? columnLayoutSpecs(blocks, slices, live) : []);
  };

  const run = () => {
    if (disposed) return;
    try {
      paginate();
    } catch (error) {
      console.warn("[docx-pagination]", error);
    }
  };
  const refresh = () => {
    if (disposed) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      run();
    });
  };

  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
    if (transaction.docChanged) refresh();
  };
  editor.on("transaction", onTransaction);
  const docZoom = editor.view.dom.closest(".doc-zoom");
  const observer = typeof ResizeObserver !== "undefined" && docZoom ? new ResizeObserver(refresh) : null;
  if (docZoom && observer) observer.observe(docZoom);
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  // D-03: a face resolving after the first pass invalidates the line-sample and
  // hf-probe caches keyed on their font epochs, so bump both before re-measuring
  // (fonts.ready fires once; loadingdone covers later faces).
  const onFontsSettled = () => {
    if (disposed) return;
    footnotes.invalidate();
    blockMetaOf = docxBlockMeta(spec.parsedDoc, footnotes.bandsOf);
    bumpHfProbeFontEpoch();
    bumpLineSampleFontEpoch();
    refresh();
  };
  if (fonts) {
    void fonts.ready.then(onFontsSettled, () => undefined);
    fonts.addEventListener?.("loadingdone", onFontsSettled);
  }
  refresh();

  return {
    refresh,
    pageCount: () => pages,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      editor.off("transaction", onTransaction);
      observer?.disconnect();
      fonts?.removeEventListener?.("loadingdone", onFontsSettled);
      colStyleEl?.remove();
      colStyleEl = null;
      if (!editor.isDestroyed) setPageGaps(editor.view, []);
    },
  };
}
