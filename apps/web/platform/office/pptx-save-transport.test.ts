import { describe, expect, it, vi } from "vitest";
import type { OfficeSaveIntent, OfficeSerializedOutput, OfficeUploadReceipt, StableSnapshot } from "@uniwork/core/office";
import type { PptxDeckSnapshot } from "./pptx-runtime";
import { createPptxSaveTransport, type PptxDocumentsTransport } from "./pptx-save-transport";

const snapshot: StableSnapshot<PptxDeckSnapshot> = { generation: 1, fingerprint: "snapshot-1", value: { revision: 0, edits: [] } };
const intent: OfficeSaveIntent<PptxDeckSnapshot> = {
  intentId: "intent-1", idempotencyKey: "save-key", snapshotGeneration: 1, snapshotFingerprint: snapshot.fingerprint, snapshot: snapshot.value, operation: "manual_save", createdAt: 0,
  identity: { deploymentId: "web", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v1", baseRevision: "9007199254740993" },
};
const output: OfficeSerializedOutput = { data: new Uint8Array([80, 75, 3, 4]), checksumSha256: "sha256", sizeBytes: 4, format: "pptx" };
const upload: OfficeUploadReceipt = { uploadId: "upload-1", checksumSha256: "sha256", sizeBytes: 4, claimExpiresAt: "2099-01-01T00:00:00Z" };

function setup() {
  const documents: PptxDocumentsTransport = {
    read: vi.fn(async () => new Uint8Array()),
    upload: vi.fn(async () => ({ upload_id: upload.uploadId, checksum_sha256: upload.checksumSha256, size_bytes: upload.sizeBytes, claim_expires_at: upload.claimExpiresAt })),
    commit: vi.fn(async () => ({ document: { id: "doc", revision: "9007199254740994" }, version: { id: "v2", checksum_sha256: "sha256", size_bytes: 4 } })),
  };
  const serialize = vi.fn(async () => ({ bytes: output.data as Uint8Array, checksum: output.checksumSha256 }));
  return { documents, serialize, transport: createPptxSaveTransport({ documentId: "doc", documents, serialize }) };
}

describe("PPTX web save transport", () => {
  it("serializes the captured snapshot and sends a PPTX blob with the same idempotency key and exact base revision", async () => {
    const { transport, documents, serialize } = setup();
    expect(await transport.serialize({ intent, snapshot })).toEqual(output);
    expect(serialize).toHaveBeenCalledWith(snapshot);
    expect(await transport.upload({ intent, output })).toEqual(upload);
    const file = vi.mocked(documents.upload).mock.calls[0]![0];
    expect(file.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(file.size).toBe(4);
    expect(vi.mocked(documents.upload).mock.calls[0]![1]).toBe(intent.idempotencyKey);
    expect(await transport.commit({ intent, upload })).toMatchObject({ documentId: "doc", revision: "9007199254740994", checksumSha256: "sha256", sizeBytes: 4 });
    expect(documents.commit).toHaveBeenCalledWith("upload-1", "9007199254740993", "save-key");
  });

  it.each([{ bytes: new Uint8Array(), checksum: "sha256" }, { bytes: new Uint8Array([1]), checksum: "" }])("refuses empty or checksum-less serialized output: %j", async (result) => {
    const { documents } = setup();
    const transport = createPptxSaveTransport({ documentId: "doc", documents, serialize: async () => result });
    await expect(transport.serialize({ intent, snapshot })).rejects.toThrow("pptx_serialized_output_invalid");
  });

  it.each([{ format: "docx" as const }, { sizeBytes: 100 }, { data: "not-bytes" }])("rejects invalid output before cloud upload: %j", async (patch) => {
    const { transport, documents } = setup();
    await expect(transport.upload({ intent, output: { ...output, ...patch } })).rejects.toThrow("pptx_serialized_output_invalid");
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it("rejects a mismatched upload checksum", async () => {
    const { transport, documents } = setup();
    vi.mocked(documents.upload).mockResolvedValue({ upload_id: "upload-1", checksum_sha256: "wrong", size_bytes: 4, claim_expires_at: upload.claimExpiresAt });
    await expect(transport.upload({ intent, output })).rejects.toThrow("pptx_upload_receipt_mismatch");
    expect(documents.commit).not.toHaveBeenCalled();
  });

  it("rejects a commit receipt that does not advance the base", async () => {
    const { transport, documents } = setup();
    vi.mocked(documents.commit).mockResolvedValue({ document: { id: "doc", revision: "9007199254740993" }, version: { id: "v2", checksum_sha256: "sha256", size_bytes: 4 } });
    await expect(transport.commit({ intent, upload })).rejects.toThrow("pptx_commit_receipt_mismatch");
  });

  it.each([{ document: { id: "other-doc", revision: "2" } }, { version: { id: "v2", checksum_sha256: "wrong", size_bytes: 4 } }, { version: { id: "", checksum_sha256: "sha256", size_bytes: 4 } }])("rejects a mismatched commit receipt: %j", async (patch) => {
    const { transport, documents } = setup();
    vi.mocked(documents.commit).mockResolvedValue({ document: { id: "doc", revision: "2" }, version: { id: "v2", checksum_sha256: "sha256", size_bytes: 4 }, ...patch });
    await expect(transport.commit({ intent, upload })).rejects.toThrow("pptx_commit_receipt_mismatch");
  });
});
