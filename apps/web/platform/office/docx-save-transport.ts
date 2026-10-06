import { uploadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import { readDocumentBytesWithinBound } from "./download-bound";
import { commitDocumentVersion } from "@uniwork/core/api/endpoints/documents-versions";
import type { OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
import type { DocxTiptapSnapshot } from "@uniwork/views/office/docx";

export interface DocxDocumentsTransport {
  read(): Promise<Uint8Array>;
  upload(file: Blob, idempotencyKey: string): Promise<{ upload_id: string; checksum_sha256: string; size_bytes: number; claim_expires_at: string } | null>;
  commit(uploadId: string, baseRevision: string, idempotencyKey: string): Promise<{
    document: { id: string; revision: string };
    version: { id: string; checksum_sha256?: string | null; size_bytes?: number; engine_name?: string | null; engine_version?: string | null; contract_version?: string | null; protocol_version?: string | null };
  } | null>;
}

export function createDocxDocumentsTransport(documentId: string): DocxDocumentsTransport {
  return {
    async read() {
      return readDocumentBytesWithinBound(documentId);
    },
    upload: (file: Blob, idempotencyKey: string) => uploadDocumentFile(documentId, file, { idempotencyKey }),
    commit: (uploadId: string, baseRevision: string, idempotencyKey: string) => commitDocumentVersion(documentId, { upload_id: uploadId, base_revision: baseRevision }, { idempotencyKey }),
  };
}

export function createDocxSaveTransport(options: {
  documentId: string;
  documents: DocxDocumentsTransport;
  serialize(snapshot: StableSnapshot<DocxTiptapSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
}): OfficeSaveTransport<DocxTiptapSnapshot> {
  return {
    async serialize({ snapshot }) {
      const result = await options.serialize(snapshot);
      if (!result.bytes.length || !result.checksum) throw new Error("docx_serialized_output_invalid");
      return { data: result.bytes, checksumSha256: result.checksum, sizeBytes: result.bytes.length, format: "docx" };
    },
    async upload({ intent, output }) {
      if (output.format !== "docx" || !(output.data instanceof Uint8Array) || output.data.length !== output.sizeBytes) throw new Error("docx_serialized_output_invalid");
      const file = new Blob([output.data.slice().buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const receipt = await options.documents.upload(file, intent.idempotencyKey);
      if (!receipt || receipt.checksum_sha256 !== output.checksumSha256 || receipt.size_bytes !== output.sizeBytes) throw new Error("docx_upload_receipt_mismatch");
      return { uploadId: receipt.upload_id, checksumSha256: receipt.checksum_sha256, sizeBytes: receipt.size_bytes, claimExpiresAt: receipt.claim_expires_at };
    },
    async commit({ intent, upload }) {
      const receipt = await options.documents.commit(upload.uploadId, intent.identity.baseRevision, intent.idempotencyKey);
      if (!receipt || receipt.document.id !== options.documentId || receipt.version.checksum_sha256 !== upload.checksumSha256 || receipt.version.size_bytes !== upload.sizeBytes) throw new Error("docx_commit_receipt_mismatch");
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
