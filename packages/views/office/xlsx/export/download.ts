// C2 (UNI-926): the browser download + print wiring. This module is the only
// host-facing half of the export path; it is deliberately DOM-only and is
// imported by the editor (a client component). A DOM-less host reuses the pure
// serializer in csv.ts and does not import this file.

/** Trigger a client-side file download from a text payload. No-op without a
 *  DOM (a renderer without `document` cannot download). */
export function downloadTextFile(filename: string, text: string, mimeType: string, doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc) return;
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Download a CSV payload (UTF-8, BOM included by the serializer). */
export function downloadCsvFile(filename: string, csv: string, doc?: Document): void {
  downloadTextFile(filename, csv, "text/csv;charset=utf-8", doc);
}

/** A safe download filename from a sheet name (the caller passes the active
 *  sheet's name, so a workbook with several sheets exports one CSV each). */
export function csvFilename(title: string | undefined): string {
  const base = (title ?? "").trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").slice(0, 80);
  return (base === "" ? "sheet" : base) + ".csv";
}

/** Print the current document through the browser's own print dialog (which
 *  offers Save as PDF where the browser does). The print stylesheet is the
 *  host's; this only invokes it. No-op without a DOM. */
export function printDocument(win: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  win?.print();
}

/** Idempotently install the print stylesheet that turns the editor into a
 *  printable grid: the toolbar, sheet tabs, formula bar and status bar are
 *  hidden and the grid region expands to the page. Semantic tokens only (no
 *  hardcoded colours); the browser's own print dialog then renders the grid. */
export function installPrintStylesheet(doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc || doc.getElementById("xlsx-print-styles")) return;
  const style = doc.createElement("style");
  style.id = "xlsx-print-styles";
  style.textContent = [
    "@media print {",
    '  [data-testid="xlsx-toolbar"],',
    '  [data-testid="xlsx-sheet-tabs"],',
    '  [data-testid="xlsx-formula-bar"],',
    '  [data-testid="xlsx-status-bar"],',
    '  [data-testid="xlsx-print-styles"] { display: none !important; }',
    '  [data-testid="xlsx-grid-surface"],',
    "  .xlsx-surface { height: auto !important; min-height: 0 !important; overflow: visible !important; }",
    "}",
  ].join("\n");
  doc.head.appendChild(style);
}
