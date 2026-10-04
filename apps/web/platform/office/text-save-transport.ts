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

/** Filename the upload part carries. FileService decides a text document's
 *  type from the verified bytes plus the extension: an unnamed part sniffs as
 *  text/plain, and the commit then refuses the version with 415
 *  format_changed. The name is a hint inside a text family the bytes already
 *  proved, so it never makes a type the content is not. */
export const TEXT_FILENAME: Record<TextFormat, string> = {
  md: "document.md",
  html: "document.html",
};

/** The engine that produces the text lane's bytes. UniWork's own
 *  `text-document.ts` serializer, not the vendored genoffice build - the
 *  bytes a Markdown/HTML save writes are never produced by genoffice. */
export const TEXT_ENGINE_NAME = "uniwork-text";
export const TEXT_ENGINE_VERSION = "text-document/1";

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
  upload(file: Blob, idempotencyKey: string, filename?: string): Promise<{ upload_id: string; checksum_sha256: string; size_bytes: number; claim_expires_at: string } | null>;
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
    upload: (file: Blob, idempotencyKey: string, filename?: string) => uploadDocumentFile(documentId, file, { idempotencyKey, filename }),
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
      // An empty document is a legitimate state (the user deletes all text, or
      // the server seeded a blank file): the engine returns `Uint8Array(0)`
      // with `sha256("")`, and the upload/commit receipt checks still hold at
      // size 0. Only a missing engine output is invalid here.
      if (!result.checksum) throw new Error("text_serialized_output_invalid");
      return { data: result.bytes, checksumSha256: result.checksum, sizeBytes: result.bytes.length, format: options.format };
    },
    async upload({ intent, output }) {
      if (output.format !== options.format) throw new Error("text_serialized_output_invalid");
      const data = bytesOf(output.data);
      if (data.length !== output.sizeBytes) throw new Error("text_serialized_output_invalid");
      const file = new Blob([data.slice().buffer], { type: TEXT_MEDIA_TYPE[options.format] });
      const receipt = await options.documents.upload(file, intent.idempotencyKey, TEXT_FILENAME[options.format]);
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
        engineName: receipt.version.engine_name ?? TEXT_ENGINE_NAME, engineVersion: receipt.version.engine_version ?? TEXT_ENGINE_VERSION,
        contractVersion: receipt.version.contract_version ?? "office-editor-host/1", protocolVersion: receipt.version.protocol_version ?? "1",
      };
    },
    // A missing reconciliation endpoint is not evidence that an ambiguous
    // commit failed. The coordinator retains the intent for an explicit retry.
    async reconcile() { return null; },
  };
}
