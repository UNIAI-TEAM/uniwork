import { PdfExportError, type PdfPageExportFile } from "./types";

const UNSAFE_FILE_CHARS = /[\p{Cc}\\:/*?"<>|]+/gu;
const EDGE_DOTS_AND_DASHES = /^[.\-\s]+|[.\-\s]+$/g;
const MAX_STEM_LENGTH = 80;

/** A filename the browser can save without a path or control character. */
export function safePdfFileStem(baseName?: string): string {
  const stem = (baseName ?? "document")
    .replace(UNSAFE_FILE_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(EDGE_DOTS_AND_DASHES, "")
    .slice(0, MAX_STEM_LENGTH);
  return stem.length > 0 ? stem : "document";
}

export function pdfPageFileName(baseName: string | undefined, pageNumber: number): string {
  return `${safePdfFileStem(baseName)}-page-${pageNumber}.png`;
}

export function pdfCopyFileName(baseName?: string): string {
  return `${safePdfFileStem(baseName)}.pdf`;
}

function targetDocument(doc?: Document): Document {
  const resolved = doc ?? (typeof document === "undefined" ? null : document);
  if (!resolved) throw new PdfExportError("unavailable", "No browser document is available for the download");
  return resolved;
}

function anchorDownload(doc: Document, href: string, filename: string): void {
  const anchor = doc.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  doc.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Hand one rendered page to the browser as a PNG download. The host render
 * result is a browser-safe URL (the render.ts PNG path returns a data URL). */
export function downloadPdfPageFile(file: PdfPageExportFile, doc?: Document): void {
  anchorDownload(targetDocument(doc), file.result.src, file.filename);
}

/** Hand the host's current PDF bytes to the browser as a file download. */
export function downloadPdfBytes(bytes: Uint8Array, filename: string, doc?: Document): void {
  const target = targetDocument(doc);
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new PdfExportError("unavailable", "Object URLs are unavailable");
  }
  // Blob parts need an ArrayBuffer-backed view; `bytes` may be shared-backed.
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  try {
    anchorDownload(target, url, filename);
  } finally {
    // Revoked on the next task: Safari reads the URL after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
