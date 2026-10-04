// C1 (UNI-924): the live document facts the HTML export embeds — the section's
// content width and the open surface's typography. The editor handle exposes no
// engine accessors, so these are read from the same DOM ids the view chrome
// resolves (see ../view/surface-targets); nothing here mutates the surface.

import { readDocxViewSurface } from "../view/surface-targets";

const TWIPS_PER_PX = 15;

export interface DocxExportContext {
  pageWidthPx?: number;
  fontFamily?: string;
  textColor?: string;
  lang?: string;
}

export function readDocxExportContext(scope: ParentNode = document): DocxExportContext {
  const context: DocxExportContext = {};
  const surface = readDocxViewSurface(scope);
  if (surface?.pageSize && surface.settings) {
    const contentWidth =
      surface.pageSize.widthPx - (surface.settings.marginLeft + surface.settings.marginRight) / TWIPS_PER_PX;
    if (contentWidth > 0) context.pageWidthPx = contentWidth;
  }
  const page = scope.querySelector('[data-testid="docx-document-surface"] .doc-page');
  if (page instanceof Element) {
    const lang = page.getAttribute("lang");
    if (lang) context.lang = lang;
    const computed = page.ownerDocument.defaultView?.getComputedStyle(page);
    const fontFamily = computed?.fontFamily;
    if (fontFamily) context.fontFamily = fontFamily;
    const color = computed?.color;
    if (color) context.textColor = color;
  }
  return context;
}
