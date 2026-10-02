// G3-05c (UNI-824) - browser entry for the vendored genoffice sheets renderer.
// Built by scripts/office/build-xlsx-browser.mjs into dist/xlsx-renderer.mjs;
// the shared XlsxEditor (packages/views/office/xlsx) consumes the typed
// surface in shims/xlsx-renderer.d.ts.
// eslint-disable-next-line import/no-unresolved -- resolved by build-xlsx-browser.mjs (`?xlsx-sheet` plugin)
import rendererSheet from "./xlsx-renderer/styles.css?xlsx-sheet";

export {
  createXlsxRenderer,
  type XlsxRendererHandle,
  type XlsxRendererHost,
  type XlsxRendererOptions,
} from "./xlsx-renderer/controller";

export const XLSX_RENDERER_STYLE_ELEMENT_ID = "uniwork-xlsx-renderer-styles";

/**
 * Mount the repackaged Univer stylesheet on the host document once. The sheet
 * is scoped to `.xlsx-surface` at build time, so it cannot leak into the app
 * shell. Idempotent per document.
 */
export function installXlsxRendererStyles(doc: Document = document): void {
  if (doc.getElementById(XLSX_RENDERER_STYLE_ELEMENT_ID)) return;
  const style = doc.createElement("style");
  style.id = XLSX_RENDERER_STYLE_ELEMENT_ID;
  style.dataset.uniworkXlsxRendererStyles = "1";
  style.textContent = rendererSheet;
  doc.head.appendChild(style);
}
