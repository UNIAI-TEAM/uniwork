import { downloadDocumentFile, getDocumentDownloadMeta } from "@uniwork/core/api/endpoints/documents";
import { ENGINE_LIMITS } from "@uniwork/office-contracts";

/**
 * Read a document's bytes for a web open, checking the size from the download
 * descriptor first so a file past the web bound never starts transferring.
 * The error carries `kind: "byte_bound"`, which every format adapter already
 * maps to failure class too_large. An unavailable or unsized descriptor is
 * not a reason to refuse: the read proceeds as before.
 */
export async function readDocumentBytesWithinBound(documentId: string, version?: number): Promise<Uint8Array> {
  const meta = await getDocumentDownloadMeta(documentId, version).catch(() => null);
  const size = meta?.file.size_bytes;
  if (typeof size === "number" && size > ENGINE_LIMITS.max_input_bytes) {
    throw Object.assign(new Error("document_too_large"), { kind: "byte_bound", code: "file_too_large" });
  }
  const blob = await downloadDocumentFile(documentId, version);
  return new Uint8Array(await blob.arrayBuffer());
}
