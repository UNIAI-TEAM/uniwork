import { DocsProtocolError, type OfficeModule } from "@uniwork/core/office/docs-frame-protocol";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";

/**
 * The largest copy of the open bytes the host hands the browser on the frame's `api.download`
 * (the conflict dialog's "Download my version, then reload" on the web). It is the server's
 * DocumentFile cap, the size past which a save is refused with 413: a version too large to
 * overwrite with is too large to download too (EXPERIENCE.md › Conflict dialog (S5)).
 */
export const OFFICE_FRAME_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

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
export function deliverFrameDownload(payload: unknown, module: OfficeModule, baseName: string): { delivered: true } {
  const data = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : undefined;
  if (!isArrayBuffer(data)) throw new DocsProtocolError({ code: "malformed", message: "api.download needs the document bytes" });
  if (data.byteLength > OFFICE_FRAME_DOWNLOAD_MAX_BYTES) {
    throw new DocsProtocolError({ code: "too_large", message: "the document is larger than a download may be", status: 413, details: { maxBytes: OFFICE_FRAME_DOWNLOAD_MAX_BYTES } });
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
