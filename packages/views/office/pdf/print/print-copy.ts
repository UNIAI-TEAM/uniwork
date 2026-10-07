import { PRINT_COPY_CSP } from "../../markdown/wysiwyg/print";
import { isInlinePrintImage } from "./render-pages";
import { PdfPrintError, type PdfPrintPage } from "./types";

export interface PdfPrintCopyInput {
  pages: readonly PdfPrintPage[];
  /** Document title for the printed page and the dialog. Escaped here. */
  title: string;
  /** Document language for the copy's `lang`; defaults to none. */
  lang?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Points with at most two decimals, truncated: the page box never ends up a
 * hair larger than the sheet, which would spill a blank sheet after it. */
function points(value: number): string {
  return `${Math.floor(value * 100) / 100}pt`;
}

function sizeKey(page: PdfPrintPage): string {
  return `${points(page.widthPt)} ${points(page.heightPt)}`;
}

/**
 * The PDF print copy: the ORIGINAL pages, one raster per sheet, nothing else.
 *
 * Built from generated markup only - every page image is a validated inline
 * `data:` raster and the title is escaped - so no document content is parsed
 * and nothing in the copy can load or run. Each distinct page size gets a
 * named `@page` with zero margins (mixed portrait/landscape keep their own
 * sheet), each page box is exactly its sheet, and `break-after: page` puts
 * every page on its own sheet. Page 1 of the printout is page 1 of the PDF.
 */
export function buildPdfPrintCopy({ pages, title, lang }: PdfPrintCopyInput): string {
  if (pages.length === 0) throw new PdfPrintError("no_pages", "PDF print needs at least one page");
  const sizes = new Map<string, number>();
  for (const page of pages) {
    if (!isInlinePrintImage(page.src)) throw new PdfPrintError("render_failed", `Page ${page.pageNumber} is not an inline image`);
    if (!(page.widthPt > 0) || !(page.heightPt > 0)) throw new PdfPrintError("render_failed", `Page ${page.pageNumber} has no size`);
    const key = sizeKey(page);
    if (!sizes.has(key)) sizes.set(key, sizes.size);
  }
  const firstSize = sizeKey(pages[0]!);
  const pageRules = [`@page { size: ${firstSize}; margin: 0; }`];
  const sizeRules: string[] = [];
  for (const [key, index] of sizes) {
    const [width, height] = key.split(" ");
    pageRules.push(`@page pdf-size-${index} { size: ${key}; margin: 0; }`);
    sizeRules.push(`.pdf-size-${index} { page: pdf-size-${index}; width: ${width}; height: ${height}; }`);
  }
  const body = pages
    .map((page) => `<div class="pdf-print-page pdf-size-${sizes.get(sizeKey(page))}" data-page="${page.pageNumber}"><img src="${page.src}" alt=""></div>`)
    .join("");
  const style = [
    ...pageRules,
    "html, body { margin: 0; padding: 0; background: #fff; }",
    "* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }",
    ".pdf-print-page { display: block; margin: 0; padding: 0; overflow: hidden; break-inside: avoid; break-after: page; }",
    ".pdf-print-page:last-child { break-after: auto; }",
    ".pdf-print-page img { display: block; width: 100%; height: 100%; }",
    ...sizeRules,
  ].join("\n");
  const langAttribute = lang ? ` lang="${escapeHtml(lang)}"` : "";
  return `<!DOCTYPE html><html${langAttribute}><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PRINT_COPY_CSP)}">`
    + `<title>${escapeHtml(title)}</title><style>${style}</style></head><body>${body}</body></html>`;
}
