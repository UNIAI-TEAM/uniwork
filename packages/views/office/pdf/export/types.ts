import type { PdfCanvasPage, PdfPageRenderService, PdfRenderResult } from "../canvas";

export type PdfExportFailureCode = "no_pages" | "cancelled" | "empty_output" | "unavailable";

export class PdfExportError extends Error {
  readonly code: PdfExportFailureCode;

  constructor(code: PdfExportFailureCode, message?: string) {
    super(message ?? `PDF export failed: ${code}`);
    this.name = "PdfExportError";
    this.code = code;
  }
}

/** One exported page: the host render result plus the filename it was saved
 * under. The view never decodes the image bytes. */
export interface PdfPageExportFile {
  pageNumber: number;
  filename: string;
  result: PdfRenderResult;
}

/** Delivery seam; defaults to the browser anchor download. */
export type PdfPageSaver = (file: PdfPageExportFile) => Promise<void> | void;

export interface PdfPageExportProgress {
  /** 1-based page position within this export run. */
  page: number;
  total: number;
}

export interface PdfPageExportRequest {
  renderer: PdfPageRenderService;
  pages: readonly PdfCanvasPage[];
  /** Rasterization scale; 2 keeps text legible at print size. */
  scale?: number;
  /** Filename stem; "-page-<n>.png" is appended. */
  fileBaseName?: string;
  signal?: AbortSignal;
  onProgress?(progress: PdfPageExportProgress): void;
  savePage?: PdfPageSaver;
}

export type PdfBytesSaver = (bytes: Uint8Array, filename: string) => Promise<void> | void;

/** Serialized bytes of the current document, owned by the host. The browser
 * contract does not expose them yet, so hosts pass this port only once they
 * can answer it (see save-copy.ts). */
export interface PdfOutputPort {
  readOutputBytes(): Promise<Uint8Array>;
}

export interface PdfSaveCopyRequest {
  output: PdfOutputPort;
  /** Filename stem; ".pdf" is appended. */
  fileBaseName?: string;
  download?: PdfBytesSaver;
}
