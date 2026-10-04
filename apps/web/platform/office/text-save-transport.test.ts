import { describe, expect, it, vi } from "vitest";
import type { OfficeSaveIntent, OfficeSerializedOutput, OfficeUploadReceipt, StableSnapshot } from "@uniwork/core/office";
import { createTextSaveTransport, TEXT_MEDIA_TYPE, type TextDocumentSnapshot, type TextDocumentsTransport } from "./text-save-transport";

// A kitchen-sink fixture: YAML frontmatter, a GFM table, fenced code, raw
// HTML and an HTML comment. The point of the text lane is that NONE of it is
// interpreted on the way to the cloud: the bytes uploaded are the bytes held.
const KITCHEN_SINK = [
  "---",
  "title: Keep every byte",
  "tags: [gfm, frontmatter]",
  "---",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```ts",
  'const value = "<not html>";',
  "```",
  "",
  '<div data-keep="yes">raw <b>HTML</b></div>',
  "<!-- comment: keep -->",
  "",
].join("\n");

const snapshot: StableSnapshot<TextDocumentSnapshot> = { generation: 1, fingerprint: "fp", value: { text: KITCHEN_SINK } };
const intent: OfficeSaveIntent<TextDocumentSnapshot> = {
  intentId: "intent-1", idempotencyKey: "save-key", snapshotGeneration: 1, snapshotFingerprint: "fp", snapshot: snapshot.value,
  operation: "manual_save", createdAt: 0,
  identity: { deploymentId: "web", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseVersionId: "v1", baseRevision: "9007199254740993" },
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setup(format: "md" | "html" = "md") {
  const documents: TextDocumentsTransport = {
    read: vi.fn(async () => new Uint8Array()),
    upload: vi.fn(async () => ({ upload_id: "upload-1", checksum_sha256: "sha256", size_bytes: 4, claim_expires_at: "2099-01-01T00:00:00Z" })),
    commit: vi.fn(async () => ({ document: { id: "doc", revision: "9007199254740994" }, version: { id: "v2", checksum_sha256: "sha256", size_bytes: 4 } })),
  };
  const serialize = vi.fn(async (captured: StableSnapshot<TextDocumentSnapshot>) => {
    const bytes = new TextEncoder().encode(captured.value.text);
    return { bytes, checksum: await sha256Hex(bytes) };
  });
  return { documents, serialize, transport: createTextSaveTransport({ documentId: "doc", format, documents, serialize }) };
}

describe("text web save transport", () => {
  it("serializes the raw source to UTF-8 and uploads it under the intent's idempotency key with the text MIME", async () => {
    const { transport, documents, serialize } = setup();
    const output = (await transport.serialize({ intent, snapshot })) as OfficeSerializedOutput;
    expect(serialize).toHaveBeenCalledWith(snapshot);
    expect(output.format).toBe("md");
    expect(new TextDecoder().decode(output.data as Uint8Array)).toBe(KITCHEN_SINK);
    expect(output.checksumSha256).toBe(await sha256Hex(new TextEncoder().encode(KITCHEN_SINK)));
    expect(output.sizeBytes).toBe(new TextEncoder().encode(KITCHEN_SINK).length);

    vi.mocked(documents.upload).mockResolvedValue({ upload_id: "upload-1", checksum_sha256: output.checksumSha256, size_bytes: output.sizeBytes, claim_expires_at: "2099-01-01T00:00:00Z" });
    const upload = (await transport.upload({ intent, output })) as OfficeUploadReceipt;
    const file = vi.mocked(documents.upload).mock.calls[0]![0];
    expect(file.type).toBe(TEXT_MEDIA_TYPE.md);
    expect(vi.mocked(documents.upload).mock.calls[0]![1]).toBe(intent.idempotencyKey);
    expect(upload).toMatchObject({ uploadId: "upload-1", checksumSha256: output.checksumSha256, sizeBytes: output.sizeBytes });

    vi.mocked(documents.commit).mockResolvedValue({ document: { id: "doc", revision: "9007199254740994" }, version: { id: "v2", checksum_sha256: output.checksumSha256, size_bytes: output.sizeBytes } });
    expect(await transport.commit({ intent, upload })).toMatchObject({ documentId: "doc", revision: "9007199254740994", checksumSha256: output.checksumSha256, sizeBytes: output.sizeBytes });
    expect(documents.commit).toHaveBeenCalledWith("upload-1", "9007199254740993", "save-key");
  });

  it("declares text/html for an HTML document", async () => {
    const { transport, documents } = setup("html");
    const output = (await transport.serialize({ intent, snapshot })) as OfficeSerializedOutput;
    expect(output.format).toBe("html");
    vi.mocked(documents.upload).mockResolvedValue({ upload_id: "upload-1", checksum_sha256: output.checksumSha256, size_bytes: output.sizeBytes, claim_expires_at: "2099-01-01T00:00:00Z" });
    await transport.upload({ intent, output });
    expect(vi.mocked(documents.upload).mock.calls[0]![0].type).toBe(TEXT_MEDIA_TYPE.html);
  });

  it.each([{ format: "docx" as const }, { sizeBytes: 100 }, { data: "not-bytes" }])("rejects invalid output before cloud upload: %j", async (patch) => {
    const { transport, documents } = setup();
    const output = (await transport.serialize({ intent, snapshot })) as OfficeSerializedOutput;
    await expect(transport.upload({ intent, output: { ...output, ...patch } })).rejects.toThrow("text_serialized_output_invalid");
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it("rejects a mismatched upload receipt", async () => {
    const { transport, documents } = setup();
    const output = (await transport.serialize({ intent, snapshot })) as OfficeSerializedOutput;
    vi.mocked(documents.upload).mockResolvedValue({ upload_id: "upload-1", checksum_sha256: "wrong", size_bytes: output.sizeBytes, claim_expires_at: "2099-01-01T00:00:00Z" });
    await expect(transport.upload({ intent, output })).rejects.toThrow("text_upload_receipt_mismatch");
    expect(documents.commit).not.toHaveBeenCalled();
  });

  it.each([{ document: { id: "other-doc", revision: "2" } }, { version: { id: "v2", checksum_sha256: "wrong", size_bytes: 4 } }])("rejects a mismatched commit receipt: %j", async (patch) => {
    const { transport, documents } = setup();
    const output = (await transport.serialize({ intent, snapshot })) as OfficeSerializedOutput;
    vi.mocked(documents.upload).mockResolvedValue({ upload_id: "upload-1", checksum_sha256: output.checksumSha256, size_bytes: output.sizeBytes, claim_expires_at: "2099-01-01T00:00:00Z" });
    const upload = (await transport.upload({ intent, output })) as OfficeUploadReceipt;
    vi.mocked(documents.commit).mockResolvedValue({ document: { id: "doc", revision: "2" }, version: { id: "v2", checksum_sha256: output.checksumSha256, size_bytes: output.sizeBytes }, ...patch });
    await expect(transport.commit({ intent, upload })).rejects.toThrow("text_commit_receipt_mismatch");
  });

  it("never reports a reconcile it cannot prove", async () => {
    const { transport } = setup();
    expect(await transport.reconcile({ intent })).toBeNull();
  });
});
