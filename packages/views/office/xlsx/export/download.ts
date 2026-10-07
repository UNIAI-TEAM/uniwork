// C2 (UNI-926): the browser download wiring (print lives in ../print since
// UNI-952). This module is the only
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
