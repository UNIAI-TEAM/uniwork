import type { DesktopPrintGeometry } from "../../../shared/ipc";

function sameGeometry(a: DesktopPrintGeometry, b: DesktopPrintGeometry): boolean {
  return a.landscape === b.landscape && a.pageSize.width === b.pageSize.width && a.pageSize.height === b.pageSize.height;
}

/** The named pages the copy declares (`@page sec2 { ... }`, one per DOCX
 * section or slide), each once. */
function namedPages(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/@page\s+(-?[A-Za-z_][\w-]*)/g)) if (match[1]) names.add(match[1]);
  return [...names];
}

/**
 * The copy laid out on the sheet the user picked in the print dialog. Every
 * Office copy declares its own `@page size` (named per DOCX section or slide),
 * and Chromium lets that win over the print options in both printToPDF and
 * print, so a changed orientation or paper would do nothing. When the choice
 * differs from the document's own geometry, one style appended last in the
 * head re-declares only `size` for the unnamed page and for every named page
 * the copy uses (`:first` included); being later at the same specificity it
 * wins, while each page keeps its margins and margin boxes (headers, footers).
 * The document's own geometry returns the copy untouched. The preview, the
 * print and the saved PDF apply the same rule, so the preview is what prints.
 */
export function withChosenSheet(html: string, chosen: DesktopPrintGeometry, documentGeometry: DesktopPrintGeometry): string {
  if (sameGeometry(chosen, documentGeometry)) return html;
  const short = Math.min(chosen.pageSize.width, chosen.pageSize.height) / 1000;
  const long = Math.max(chosen.pageSize.width, chosen.pageSize.height) / 1000;
  const size = `{size:${chosen.landscape ? `${long}mm ${short}mm` : `${short}mm ${long}mm`}}`;
  const selectors = ["", ...namedPages(html).map((name) => ` ${name}`)];
  const rules = selectors.map((selector) => `@page${selector}${size}@page${selector}:first${size}`).join("");
  const style = `<style data-print-sheet>${rules}</style>`;
  const close = html.search(/<\/head>/i);
  return close === -1 ? `${style}${html}` : `${html.slice(0, close)}${style}${html.slice(close)}`;
}
