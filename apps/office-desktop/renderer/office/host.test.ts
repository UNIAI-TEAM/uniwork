import { describe, expect, it, vi } from "vitest";
import { createDesktopOfficeSaveTransport, createDesktopOfficeHost } from "./host";

const context = { sessionGeneration: "session_1234", workspaceId: "ws-1", documentId: "doc-1" } as const;
const openResponse = { document: { id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file" as const, format: "docx" as const, version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true }, data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")), filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const, checksum: `sha256:${"a".repeat(64)}` };

describe("desktop office host injection", () => {
  it("reads through the typed download command, opens every format-table format and refuses the rest", async () => {
    const bridge = { call: vi.fn(async () => ({ data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")), document: { id: "doc-1", revision: "9" } })) };
    const host = createDesktopOfficeHost({ bridge: bridge as never, context });
    await expect(host.read.readDocument("doc-1")).resolves.toEqual(new Uint8Array([104, 101, 108, 108, 111]));
    for (const format of ["docx", "pdf", "md", "html", "xlsx", "pptx"] as const) {
      await expect(host.read.openDocument("doc-1", format)).resolves.toMatchObject({ outcome: "opened" });
    }
    await expect(host.read.openDocument("doc-1", "txt" as never)).resolves.toMatchObject({ outcome: "failed", failure_class: "unsupported_feature" });
  });

  it("uses one office-save command with the same intent and idempotency key", async () => {
    const bridge = { call: vi.fn(async () => openResponse.document ? { intentId: "intent-1", idempotencyKey: "key-1", documentId: "doc-1", versionId: "version-2", revision: "10", checksum: `sha256:${"b".repeat(64)}` } : undefined) };
    const transport = createDesktopOfficeSaveTransport({ bridge: bridge as never, context, format: "docx", serialize: async () => ({ bytes: new Uint8Array([1, 2, 3]), checksum: `sha256:${"b".repeat(64)}` }) });
    const intent = { intentId: "intent-1", idempotencyKey: "key-1", identity: { documentId: "doc-1", baseVersionId: "version-1", baseRevision: "9" } };
    const output = await transport.serialize({ intent, snapshot: { value: { text: "changed" } } });
    const upload = await transport.upload({ intent, output });
    const receipt = await transport.commit({ intent, upload });
    expect(receipt).toMatchObject({ intentId: "intent-1", idempotencyKey: "key-1", revision: "10" });
    expect(bridge.call).toHaveBeenCalledTimes(1);
    expect(bridge.call).toHaveBeenCalledWith("desktop:office-save", expect.objectContaining({ format: "docx", intentId: "intent-1", idempotencyKey: "key-1", baseRevision: "9" }));
  });
});
