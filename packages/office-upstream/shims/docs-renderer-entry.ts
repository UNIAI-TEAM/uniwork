// eslint-disable-next-line import/no-unresolved -- resolved by build-docx-browser.mjs (`?docx-sheet` plugin)
import rendererSheet from "../upstream/apps/docs/src/renderer/styles.css?docx-sheet";
export { editorExtensions } from "../upstream/apps/docs/src/renderer/editor/extensions";
export { blocksToPmDoc, pmDocToSavePlan, pmDocOptions, inlineToRuns, pmNodeToGeneratedBlock } from "../upstream/apps/docs/src/renderer/editor/convert";
export { parseDocx, saveDocx, readSections } from "../upstream/packages/docx-engine/src/index";
export { PageFootnotes, PageEndnotes } from "../upstream/apps/docs/src/renderer/components/PageNoteAreas";
export { setNoteNumFmts } from "../upstream/apps/docs/src/renderer/note-format";
export { endnotesAnchorY } from "../upstream/apps/docs/src/renderer/pagination-measure";
// G3-04c T-02 (UNI-823): the pagination engine and the HF strip builders. The
// UniWork handle is the App for this renderer, so it drives measure -> slice ->
// gap itself; these are the vendored pure functions that loop calls.
export {
  assignSections,
  bumpLineSampleFontEpoch,
  columnLayoutSpecs,
  docCharSpacePt,
  docGridPitchPt,
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
  sectionBidi,
  sectionColGeom,
  sectionColumns,
  sectionFirstPages,
  sectionGeoms,
  sectionPageBox,
  sliceWithLineSplit,
  tableRowFlags,
  visiblePageCount,
} from "../upstream/apps/docs/src/renderer/pagination";
export {
  GAP_BAND,
  pageFramesFromGaps,
  setPageGaps,
  setRowFills,
} from "../upstream/apps/docs/src/renderer/editor/pagination-gaps";
// G3-04d R1 (UNI-823): mixed-column canvas placements (documents whose sections
// disagree on the column spec) need the decoration channel the upstream App
// drives; the vendored extension carries the whole paint path.
export { setColumnLayout } from "../upstream/apps/docs/src/renderer/editor/column-layout";
// G3-04d T (UNI-823): the document stylesheet generator (styles.xml + theme).
export {
  docBodyFont,
  docHasCjk,
  docLineFactor,
  docStyleCss,
  docThemeCss,
} from "../upstream/apps/docs/src/renderer/doc-style-css";
export {
  bumpHfProbeFontEpoch,
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
