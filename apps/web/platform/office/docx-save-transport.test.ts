import { describe, expect, it, vi } from "vitest";
import type { OfficeSaveIntent, OfficeSerializedOutput, OfficeUploadReceipt, StableSnapshot } from "@uniwork/core/office";
import type { DocxTiptapSnapshot } from "@uniwork/views/office/docx";
import { createDocxSaveTransport, type DocxDocumentsTransport } from "./docx-save-transport";

const snapshot: StableSnapshot<DocxTiptapSnapshot> = { generation: 1, fingerprint: "snapshot-1", value: { doc: { type: "doc", content: [] }, sourceBase64: "UEs=" } };
const intent: OfficeSaveIntent<DocxTiptapSnapshot> = {
  intentId: "intent-1", idempotencyKey: "save-key", snapshotGeneration: 1, snapshotFingerprint: snapshot.fingerprint, snapshot: snapshot.value, operation: "manual_save", createdAt: 0,
  identity: { deploymentId: "web", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v1", baseRevision: "9007199254740993" },
};
const output: OfficeSerializedOutput = { data: new Uint8Array([80, 75, 3, 4]), checksumSha256: "sha256", sizeBytes: 4, format: "docx" };
const upload: OfficeUploadReceipt = { uploadId: "upload-1", checksumSha256: "sha256", sizeBytes: 4, claimExpiresAt: "2099-01-01T00:00:00Z" };

function setup() {
  const documents: DocxDocumentsTransport = {
    read: vi.fn(async () => new Uint8Array()),
    upload: vi.fn(async () => ({ upload_id: upload.uploadId, checksum_sha256: upload.checksumSha256, size_bytes: upload.sizeBytes, claim_expires_at: upload.claimExpiresAt })),
    commit: vi.fn(async () => ({ document: { id: "doc", revision: "9007199254740994" }, version: { id: "v2", checksum_sha256: "sha256", size_bytes: 4 } })),
  };
  const serialize = vi.fn(async () => ({ bytes: output.data as Uint8Array, checksum: output.checksumSha256 }));
  return { documents, serialize, transport: createDocxSaveTransport({ documentId: "doc", documents, serialize }) };
}

describe("DOCX web save transport", () => {
  it("serializes the captured snapshot and sends a DOCX blob with the same idempotency key and exact base revision", async () => {
    const { transport, documents, serialize } = setup();
    expect(await transport.serialize({ intent, snapshot })).toEqual(output);
    expect(serialize).toHaveBeenCalledWith(snapshot);
    expect(await transport.upload({ intent, output })).toEqual(upload);
    const file = vi.mocked(documents.upload).mock.calls[0]![0];
    expect(file.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(file.size).toBe(4);
    expect(vi.mocked(documents.upload).mock.calls[0]![1]).toBe(intent.idempotencyKey);
    expect(await transport.commit({ intent, upload })).toMatchObject({ documentId: "doc", revision: "9007199254740994", checksumSha256: "sha256", sizeBytes: 4 });
    expect(documents.commit).toHaveBeenCalledWith("upload-1", "9007199254740993", "save-key");
  });

  it.each([{ format: "xlsx" as const }, { sizeBytes: 100 }, { data: "not-bytes" }])("rejects invalid output before cloud upload: %j", async (patch) => {
    const { transport, documents } = setup();
    await expect(transport.upload({ intent, output: { ...output, ...patch } })).rejects.toThrow("docx_serialized_output_invalid");
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it("rejects a mismatched upload checksum", async () => {
    const { transport, documents } = setup();
    vi.mocked(documents.upload).mockResolvedValue({ upload_id: "upload-1", checksum_sha256: "wrong", size_bytes: 4, claim_expires_at: upload.claimExpiresAt });
    await expect(transport.upload({ intent, output })).rejects.toThrow("docx_upload_receipt_mismatch");
    expect(documents.commit).not.toHaveBeenCalled();
  });

  it.each([{ document: { id: "other-doc", revision: "2" } }, { version: { id: "v2", checksum_sha256: "wrong", size_bytes: 4 } }])("rejects a mismatched commit receipt: %j", async (patch) => {
    const { transport, documents } = setup();
    vi.mocked(documents.commit).mockResolvedValue({ document: { id: "doc", revision: "2" }, version: { id: "v2", checksum_sha256: "sha256", size_bytes: 4 }, ...patch });
    await expect(transport.commit({ intent, upload })).rejects.toThrow("docx_commit_receipt_mismatch");
  });
});
