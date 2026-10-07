import type { DesktopPrintGeometry } from "../../../shared/ipc";

function sameGeometry(a: DesktopPrintGeometry, b: DesktopPrintGeometry): boolean {
  return a.landscape === b.landscape && a.pageSize.width === b.pageSize.width && a.pageSize.height === b.pageSize.height;
}

/**
 * The copy laid out on the sheet the user picked in the print dialog. Every
 * Office copy declares its own `@page size` (named per DOCX section or slide),
 * and Chromium lets that win over the print options in both printToPDF and
 * print, so a changed orientation or paper would do nothing. When the choice
 * differs from the document's own geometry, one rule appended last in the
 * head puts every page on the chosen sheet (named pages folded into the
 * unnamed one, `:first` included); margins and content stay the copy's. The
 * document's own geometry returns the copy untouched. The preview and the
 * print apply the same rule, so what the preview shows is what prints.
 */
export function withChosenSheet(html: string, chosen: DesktopPrintGeometry, documentGeometry: DesktopPrintGeometry): string {
  if (sameGeometry(chosen, documentGeometry)) return html;
  const short = Math.min(chosen.pageSize.width, chosen.pageSize.height) / 1000;
  const long = Math.max(chosen.pageSize.width, chosen.pageSize.height) / 1000;
  const size = chosen.landscape ? `${long}mm ${short}mm` : `${short}mm ${long}mm`;
  const rule = `<style data-print-sheet>html,body,body *{page:auto!important}@page{size:${size}}@page :first{size:${size}}</style>`;
  const close = html.search(/<\/head>/i);
  return close === -1 ? `${rule}${html}` : `${html.slice(0, close)}${rule}${html.slice(close)}`;
}
