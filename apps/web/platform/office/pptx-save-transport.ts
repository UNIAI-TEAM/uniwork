// UNI-927 (P0-1) — the web PPTX save transport.
//
// Mirrors docx-save-transport.ts: the only cloud write path is upload then
// Documents version commit, with both receipts checked against the serialized
// bytes before the coordinator may report success. serialize() delegates to
// the browser runtime (PptxAdapter.serialize -> vendored savePptx).
import { downloadDocumentFile, uploadDocumentFile } from "@uniwork/core/api/endpoints/documents";
import { commitDocumentVersion } from "@uniwork/core/api/endpoints/documents-versions";
import type { OfficeSaveTransport, StableSnapshot } from "@uniwork/core/office";
import type { PptxDeckSnapshot } from "./pptx-runtime";

/** The genoffice commit the vendored pptx engine is pinned to. */
export const PPTX_ENGINE_VERSION = "09485f884dc845cf3bf27fb7edfe489f9d457aad";

export interface PptxDocumentsTransport {
  read(): Promise<Uint8Array>;
  upload(file: Blob, idempotencyKey: string): Promise<{ upload_id: string; checksum_sha256: string; size_bytes: number; claim_expires_at: string } | null>;
  commit(uploadId: string, baseRevision: string, idempotencyKey: string): Promise<{
    document: { id: string; revision: string };
    version: { id: string; checksum_sha256?: string | null; size_bytes?: number; engine_name?: string | null; engine_version?: string | null; contract_version?: string | null; protocol_version?: string | null };
  } | null>;
}

export function createPptxDocumentsTransport(documentId: string): PptxDocumentsTransport {
  return {
    async read() {
      const blob = await downloadDocumentFile(documentId);
      return new Uint8Array(await blob.arrayBuffer());
    },
    upload: (file: Blob, idempotencyKey: string) => uploadDocumentFile(documentId, file, { idempotencyKey }),
    commit: (uploadId: string, baseRevision: string, idempotencyKey: string) =>
      commitDocumentVersion(documentId, { upload_id: uploadId, base_revision: baseRevision }, { idempotencyKey }),
  };
}

export interface PptxSaveTransportOptions {
  documentId: string;
  documents: PptxDocumentsTransport;
  serialize(snapshot: StableSnapshot<PptxDeckSnapshot>): Promise<{ bytes: Uint8Array; checksum: string }>;
}

export function createPptxSaveTransport(options: PptxSaveTransportOptions): OfficeSaveTransport<PptxDeckSnapshot> {
  return {
    async serialize({ snapshot }) {
      const result = await options.serialize(snapshot);
      if (!result.bytes.length || !result.checksum) throw new Error("pptx_serialized_output_invalid");
      return { data: result.bytes, checksumSha256: result.checksum, sizeBytes: result.bytes.length, format: "pptx" };
    },
    async upload({ intent, output }) {
      if (output.format !== "pptx" || !(output.data instanceof Uint8Array) || output.data.length !== output.sizeBytes) {
        throw new Error("pptx_serialized_output_invalid");
      }
      const file = new Blob([output.data.slice().buffer], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      const receipt = await options.documents.upload(file, intent.idempotencyKey);
      if (!receipt || receipt.checksum_sha256 !== output.checksumSha256 || receipt.size_bytes !== output.sizeBytes) {
        throw new Error("pptx_upload_receipt_mismatch");
      }
      return { uploadId: receipt.upload_id, checksumSha256: receipt.checksum_sha256, sizeBytes: receipt.size_bytes, claimExpiresAt: receipt.claim_expires_at };
    },
    async commit({ intent, upload }) {
      const receipt = await options.documents.commit(upload.uploadId, intent.identity.baseRevision, intent.idempotencyKey);
      if (!receipt || !receipt.version.id || !receipt.document.id || !/^\d+$/.test(receipt.document.revision)) {
        throw new Error("pptx_commit_receipt_mismatch");
      }
      if (receipt.document.id !== options.documentId || BigInt(receipt.document.revision) <= BigInt(intent.identity.baseRevision)) {
        throw new Error("pptx_commit_receipt_mismatch");
      }
      if (receipt.version.checksum_sha256 !== upload.checksumSha256 || receipt.version.size_bytes !== upload.sizeBytes) {
        throw new Error("pptx_commit_receipt_mismatch");
      }
      return {
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        documentId: receipt.document.id,
        versionId: receipt.version.id,
        revision: receipt.document.revision,
        checksumSha256: receipt.version.checksum_sha256,
        sizeBytes: receipt.version.size_bytes,
        engineName: receipt.version.engine_name ?? "genoffice",
        engineVersion: receipt.version.engine_version ?? PPTX_ENGINE_VERSION,
        contractVersion: receipt.version.contract_version ?? "office-editor-host/1",
        protocolVersion: receipt.version.protocol_version ?? "1",
      };
    },
    // A missing reconciliation endpoint is not evidence that an ambiguous
    // commit failed. The coordinator retains the intent for an explicit retry.
    async reconcile() {
      return null;
    },
  };
}
