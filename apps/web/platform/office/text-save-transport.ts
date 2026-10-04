import { downloadDocumentFile, uploadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import { commitDocumentVersion } from "@uniwork/core/api/endpoints/documents-versions";
import type { OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";

// The text counterpart of docx-save-transport.ts. A Markdown/HTML document is
// its SOURCE text: serializing it is UTF-8 of that text (plus the BOM the
// source carried, which the engine keeps as an encoding property, not a
// character). Nothing is parsed or normalised here - the bytes a save writes
// are the bytes the editor holds - so the cloud write path is the same
// upload-then-commit pair the DOCX and XLSX lanes use, under the same
// idempotency key and the same receipt cross-checks.

export type TextFormat = "md" | "html";

/** The snapshot value a text editor captures: the raw document source. */
export interface TextDocumentSnapshot {
  text: string;
}

/** MIME the upload declares. The server keys the version row on it. */
export const TEXT_MEDIA_TYPE: Record<TextFormat, string> = {
  md: "text/markdown",
  html: "text/html",
};

/**
 * Normalise serialized bytes to a Uint8Array in THIS realm. `instanceof
 * Uint8Array` is realm-bound: bytes produced by a TextEncoder in a jsdom test
 * realm (or another frame) are a genuine Uint8Array that fails the check, so
 * the transport reads the view instead of rejecting a valid payload.
 */
function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new Error("text_serialized_output_invalid");
}

export interface TextDocumentsTransport {
  read(): Promise<Uint8Array>;
  upload(file: Blob, idempotencyKey: string): Promise<{ upload_id: string; checksum_sha256: string; size_bytes: number; claim_expires_at: string } | null>;
  commit(uploadId: string, baseRevision: string, idempotencyKey: string): Promise<{
    document: { id: string; revision: string };
    version: { id: string; checksum_sha256?: string | null; size_bytes?: number; engine_name?: string | null; engine_version?: string | null; contract_version?: string | null; protocol_version?: string | null };
  } | null>;
}

export function createTextDocumentsTransport(documentId: string): TextDocumentsTransport {
  return {
    async read() {
      const blob = await downloadDocumentFile(documentId);
      return new Uint8Array(await blob.arrayBuffer());
    },
    upload: (file: Blob, idempotencyKey: string) => uploadDocumentFile(documentId, file, { idempotencyKey }),
    commit: (uploadId: string, baseRevision: string, idempotencyKey: string) => commitDocumentVersion(documentId, { upload_id: uploadId, base_revision: baseRevision }, { idempotencyKey }),
  };
}

export function createTextSaveTransport(options: {
  documentId: string;
  format: TextFormat;
  documents: TextDocumentsTransport;
  serialize(snapshot: StableSnapshot<TextDocumentSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
}): OfficeSaveTransport<TextDocumentSnapshot> {
  return {
    async serialize({ snapshot }) {
      const result = await options.serialize(snapshot);
      if (!result.bytes.length || !result.checksum) throw new Error("text_serialized_output_invalid");
      return { data: result.bytes, checksumSha256: result.checksum, sizeBytes: result.bytes.length, format: options.format };
    },
    async upload({ intent, output }) {
      if (output.format !== options.format) throw new Error("text_serialized_output_invalid");
      const data = bytesOf(output.data);
      if (data.length !== output.sizeBytes) throw new Error("text_serialized_output_invalid");
      const file = new Blob([data.slice().buffer], { type: TEXT_MEDIA_TYPE[options.format] });
      const receipt = await options.documents.upload(file, intent.idempotencyKey);
      if (!receipt || receipt.checksum_sha256 !== output.checksumSha256 || receipt.size_bytes !== output.sizeBytes) throw new Error("text_upload_receipt_mismatch");
      return { uploadId: receipt.upload_id, checksumSha256: receipt.checksum_sha256, sizeBytes: receipt.size_bytes, claimExpiresAt: receipt.claim_expires_at };
    },
    async commit({ intent, upload }) {
      const receipt = await options.documents.commit(upload.uploadId, intent.identity.baseRevision, intent.idempotencyKey);
      if (!receipt || receipt.document.id !== options.documentId || receipt.version.checksum_sha256 !== upload.checksumSha256 || receipt.version.size_bytes !== upload.sizeBytes) throw new Error("text_commit_receipt_mismatch");
      return {
        intentId: intent.intentId, idempotencyKey: intent.idempotencyKey,
        documentId: receipt.document.id, versionId: receipt.version.id, revision: receipt.document.revision,
        checksumSha256: receipt.version.checksum_sha256, sizeBytes: receipt.version.size_bytes,
        engineName: receipt.version.engine_name ?? "genoffice", engineVersion: receipt.version.engine_version ?? "09485f884dc845cf3bf27fb7edfe489f9d457aad",
        contractVersion: receipt.version.contract_version ?? "office-editor-host/1", protocolVersion: receipt.version.protocol_version ?? "1",
      };
    },
    // A missing reconciliation endpoint is not evidence that an ambiguous
    // commit failed. The coordinator retains the intent for an explicit retry.
    async reconcile() { return null; },
  };
}
