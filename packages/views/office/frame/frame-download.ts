import { DEFAULT_DOCUMENT_MAX_BYTES } from "@uniwork/core/documents/limits";
import { DocsProtocolError, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";

const DOWNLOAD_HEADROOM_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_FLOOR_BYTES = 256 * 1024 * 1024;

/**
 * Ceiling for `api.download` and `InitPayload.downloadMaxBytes` (OQ-SIZE-3 / contract §4 item 3):
 * `max(upload_max_bytes + 64 MiB, 256 MiB)` so a user whose in-memory document slightly exceeds
 * `upload_max_bytes` can still download their working copy when save is blocked.
 */
export function frameDownloadMaxBytes(uploadMaxBytes: number = DEFAULT_DOCUMENT_MAX_BYTES): number {
  const base = Number.isFinite(uploadMaxBytes) && uploadMaxBytes > 0 ? uploadMaxBytes : DEFAULT_DOCUMENT_MAX_BYTES;
  return Math.max(base + DOWNLOAD_HEADROOM_BYTES, DOWNLOAD_FLOOR_BYTES);
}

/** Characters no desktop file system accepts in a name; each becomes `_` (OQ-UX12). */
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|]/g;

/** A file name from a document title: forbidden characters replaced, never empty. */
export function downloadFileName(base: string, module: OfficeModule): string {
  const name = base.replace(FORBIDDEN_NAME_CHARS, "_").trim() || "document";
  return `${name}.${officeModuleSpec(module).extension}`;
}

const isArrayBuffer = (x: unknown): x is ArrayBuffer =>
  x instanceof ArrayBuffer || Object.prototype.toString.call(x) === "[object ArrayBuffer]";

/**
 * Check the frame's bytes and hand them to the browser as one download from this page's origin.
 * The frame sends bytes only: the name, extension and MIME type are the host's (the module's own
 * format), and nothing reaches the server. Refusals use the protocol's existing codes.
 */
export function deliverFrameDownload(
  payload: unknown,
  module: OfficeModule,
  baseName: string,
  maxBytes: number = frameDownloadMaxBytes(),
): { delivered: true } {
  const data = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : undefined;
  if (!isArrayBuffer(data)) throw new DocsProtocolError({ code: "malformed", message: "api.download needs the document bytes" });
  if (data.byteLength > maxBytes) {
    throw new DocsProtocolError({ code: "too_large", message: "the document is larger than a download may be", status: 413, details: { maxBytes } });
  }
  const url = URL.createObjectURL(new Blob([data], { type: officeModuleSpec(module).mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadFileName(baseName, module);
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // The click has started the download; the next task is late enough for every browser to have read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return { delivered: true };
}
