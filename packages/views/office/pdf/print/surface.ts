/** Attributes the print stylesheet keys on. They exist only for the duration
 * of a print dialog: `data-pdf-print-active` on the document root turns the
 * scope on, the other two select what the printer keeps. */
export const PDF_PRINT_ACTIVE_ATTRIBUTE = "data-pdf-print-active";
export const PDF_PRINT_SURFACE_ATTRIBUTE = "data-pdf-print-surface";
export const PDF_PRINT_ANCESTOR_ATTRIBUTE = "data-pdf-print-ancestor";

/** Mark the surface and its ancestor chain for the print stylesheet and return
 * the cleanup that removes every mark. Ancestors are marked so scroll clips
 * and fixed heights do not cut printed pages off after the first viewport. */
export function markPdfPrintSurface(surface: HTMLElement): () => void {
  const documentRoot = surface.ownerDocument;
  const marked: HTMLElement[] = [surface];
  for (let node = surface.parentElement; node; node = node.parentElement) marked.push(node);
  documentRoot.documentElement.setAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE, "");
  for (const node of marked) {
    node.setAttribute(node === surface ? PDF_PRINT_SURFACE_ATTRIBUTE : PDF_PRINT_ANCESTOR_ATTRIBUTE, "");
  }
  return () => {
    documentRoot.documentElement.removeAttribute(PDF_PRINT_ACTIVE_ATTRIBUTE);
    for (const node of marked) {
      node.removeAttribute(PDF_PRINT_SURFACE_ATTRIBUTE);
      node.removeAttribute(PDF_PRINT_ANCESTOR_ATTRIBUTE);
    }
  };
}
