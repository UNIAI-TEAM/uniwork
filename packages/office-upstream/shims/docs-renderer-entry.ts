// eslint-disable-next-line import/no-unresolved -- resolved by build-docx-browser.mjs (`?docx-sheet` plugin)
import rendererSheet from "../upstream/apps/docs/src/renderer/styles.css?docx-sheet";
export { editorExtensions } from "../upstream/apps/docs/src/renderer/editor/extensions";
export { blocksToPmDoc, pmDocToSavePlan, pmDocOptions, inlineToRuns, pmNodeToGeneratedBlock } from "../upstream/apps/docs/src/renderer/editor/convert";
export { parseDocx, saveDocx } from "../upstream/packages/docx-engine/src/index";

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
