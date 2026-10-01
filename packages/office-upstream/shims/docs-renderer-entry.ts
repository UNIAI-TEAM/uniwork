// eslint-disable-next-line import/no-unresolved -- resolved by build-docx-browser.mjs (`?docx-sheet` plugin)
import rendererSheet from "../upstream/apps/docs/src/renderer/styles.css?docx-sheet";
export { editorExtensions } from "../upstream/apps/docs/src/renderer/editor/extensions";
export { blocksToPmDoc, pmDocToSavePlan, pmDocOptions, inlineToRuns, pmNodeToGeneratedBlock } from "../upstream/apps/docs/src/renderer/editor/convert";
export { parseDocx, saveDocx, readSections } from "../upstream/packages/docx-engine/src/index";
// G3-04c T-02 (UNI-823): the pagination engine and the HF strip builders. The
// UniWork handle is the App for this renderer, so it drives measure -> slice ->
// gap itself; these are the vendored pure functions that loop calls.
export {
  assignSections,
  effectiveBottomPx,
  effectiveHfRefs,
  effectiveTopPx,
  formatPageNumber,
  hfVariantOf,
  lineStartAnchor,
  liveSections,
  measureBlocks,
  nextLineAnchor,
  pageNumbers,
  sectionFirstPages,
  sectionGeoms,
  sectionPageBox,
  sliceWithLineSplit,
  visiblePageCount,
} from "../upstream/apps/docs/src/renderer/pagination";
export {
  GAP_BAND,
  setPageGaps,
  setRowFills,
} from "../upstream/apps/docs/src/renderer/editor/pagination-gaps";
export {
  hfHasVisibleContent,
  hfReservedHeightPx,
  hfStripGeom,
  makeGapHfEl,
} from "../upstream/apps/docs/src/renderer/editor/hf-dom";

export const DOCX_RENDERER_STYLE_ELEMENT_ID = "uniwork-docx-renderer-styles";

/**
 * G3-04c T-01 (UNI-823): mount the vendored renderer stylesheet on the host
 * document. The sheet is repackaged for the `.docx-surface` root at build time
 * (scripts/office/docx-renderer-styles.mjs), so it styles the DOCX surface and
 * cannot leak into the surrounding app shell. Idempotent per document.
 */
export function installDocxRendererStyles(doc: Document = document): void {
  if (doc.getElementById(DOCX_RENDERER_STYLE_ELEMENT_ID)) return;
  const style = doc.createElement("style");
  style.id = DOCX_RENDERER_STYLE_ELEMENT_ID;
  style.dataset.uniworkDocxRendererStyles = "1";
  style.textContent = rendererSheet;
  doc.head.appendChild(style);
}
