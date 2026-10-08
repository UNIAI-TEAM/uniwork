import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { DocsProtocolError } from "@uniwork/core/office/docs-frame-protocol";

const mocks = vi.hoisted(() => ({
  mint: vi.fn(),
  client: { open: vi.fn(), content: vi.fn(), upload: vi.fn(), commit: vi.fn(), recents: vi.fn(), uploadAsset: vi.fn() },
  create: vi.fn(),
}));
vi.mock("@uniwork/core/api/endpoints/office-frame", () => ({ mintOfficeFrameToken: mocks.mint, createOfficeFrameClient: mocks.create }));

import { createDocsFrameApi } from "./docs-frame-api";

const call = { workspaceId: "ws-1", documentId: "doc-1", token: "tok-1", signal: new AbortController().signal };
const frameDoc = (over: Record<string, unknown> = {}) => ({
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", title: "Spec", revision: "7", can_edit: true,
  file: { file_id: "file-1", version_id: "ver-7", version: 7, filename: "spec.docx", mime_type: "application/docx", size_bytes: 3, checksum_sha256: "x" },
  download_url: "/api/v1/office-frame/documents/doc-1/content?version=7", updated_at: "2026-10-08T10:00:00Z", ...over,
});

beforeEach(() => {
  mocks.mint.mockReset();
  mocks.create.mockReset().mockReturnValue(mocks.client);
  for (const fn of Object.values(mocks.client)) fn.mockReset();
});

describe("createDocsFrameApi", () => {
  it("mints a token for the document and reports its absolute expiry", async () => {
    mocks.mint.mockResolvedValue({ token: "tok", expires_at: "2026-10-08T10:10:00Z" });
    await expect(createDocsFrameApi().mintToken({ workspaceId: "ws-1", documentId: "doc-1" })).resolves.toEqual({ token: "tok", tokenExpiresAt: Date.parse("2026-10-08T10:10:00Z") });
    mocks.mint.mockResolvedValue(null);
    await expect(createDocsFrameApi().mintToken({ workspaceId: "ws-1", documentId: "doc-1" })).rejects.toMatchObject({ code: "internal" });
  });

  it("calls the frame routes with the call's token only and hands the frame bytes, not a URL", async () => {
    mocks.client.open.mockResolvedValue(frameDoc());
    mocks.client.content.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const opened = await createDocsFrameApi().open({ fileId: "file-1" }, call);
    expect(mocks.create.mock.calls[0]![0].getToken()).toBe("tok-1");
    expect(mocks.client.content).toHaveBeenCalledWith("/api/v1/office-frame/documents/doc-1/content?version=7", call.signal);
    expect(opened.file).toMatchObject({ fileId: "file-1", name: "spec.docx", versionId: "ver-7", etag: "7", writable: true, modifiedAt: Date.parse("2026-10-08T10:00:00Z") });
    expect(opened.source.kind).toBe("bytes");
    expect(new Uint8Array((opened.source as { data: ArrayBuffer }).data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("saves as upload then commit against the etag and answers the new version", async () => {
    const api = createDocsFrameApi();
    mocks.client.open.mockResolvedValue(frameDoc());
    mocks.client.content.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) });
    await api.open({ fileId: "file-1" }, call);
    mocks.client.upload.mockResolvedValue({ upload_id: "up-1" });
    mocks.client.commit.mockResolvedValue(frameDoc({ revision: "8", file: { ...frameDoc().file, version_id: "ver-8" } }));
    const result = await api.save({ fileId: "file-1", data: new Uint8Array([9, 9]).buffer, etag: "7" }, call);
    expect(mocks.client.upload.mock.calls[0]!.slice(0, 1).concat(mocks.client.upload.mock.calls[0]![2])).toEqual(["doc-1", "spec.docx"]);
    expect(mocks.client.commit).toHaveBeenCalledWith("doc-1", { upload_id: "up-1", base_revision: "7" }, expect.stringContaining("doc-1-7-2"));
    expect(result).toMatchObject({ ok: true, versionId: "ver-8", file: { etag: "8" } });
  });

  it("reads the current revision when the frame has no etag, and names a missing filename", async () => {
    mocks.client.open.mockResolvedValue(frameDoc({ revision: "5" }));
    mocks.client.upload.mockResolvedValue({ upload_id: "up-2" });
    mocks.client.commit.mockResolvedValue(frameDoc({ revision: "6" }));
    await createDocsFrameApi().save({ fileId: "file-1", data: new ArrayBuffer(1) }, call);
    expect(mocks.client.commit.mock.calls[0]![1]).toEqual({ upload_id: "up-2", base_revision: "5" });
  });

  it("turns a stale base into a protocol conflict that carries the current revision", async () => {
    mocks.client.upload.mockResolvedValue({ upload_id: "up-1" });
    mocks.client.commit.mockRejectedValue(new ApiError("stale", "document_version_conflict", 409, undefined, { current_revision: "9" }));
    const failure = await createDocsFrameApi().save({ fileId: "f", data: new ArrayBuffer(1), etag: "7" }, call).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DocsProtocolError);
    expect(failure).toMatchObject({ code: "conflict", status: 409, details: { currentRevision: "9" } });
  });

  it("maps other API failures by status and an unreadable body to an internal error", async () => {
    mocks.client.open.mockRejectedValue(new ApiError("no", "forbidden", 403));
    await expect(createDocsFrameApi().open({ fileId: "f" }, call)).rejects.toMatchObject({ code: "forbidden" });
    mocks.client.open.mockResolvedValue(null);
    await expect(createDocsFrameApi().open({ fileId: "f" }, call)).rejects.toMatchObject({ code: "internal" });
  });

  it("lists recents and uploads images through the frame client", async () => {
    mocks.client.recents.mockResolvedValue({ items: [{ document_id: "d2", title: "Other", updated_at: "2026-10-08T09:00:00Z" }, { document_id: "d3", title: "No date" }] });
    const recents = await createDocsFrameApi().recents({ limit: 5 }, call);
    expect(mocks.client.recents).toHaveBeenCalledWith("doc-1", 5);
    expect(recents.files).toEqual([{ fileId: "d2", name: "Other", modifiedAt: Date.parse("2026-10-08T09:00:00Z") }, { fileId: "d3", name: "No date" }]);
    mocks.client.uploadAsset.mockResolvedValue({ asset_id: "a1", url: "/api/v1/office-frame/documents/doc-1/assets/a1?sig=s" });
    await expect(createDocsFrameApi().uploadImage({ name: "p.png", mimeType: "image/png", data: new ArrayBuffer(2) }, call)).resolves.toEqual({ imageId: "a1", url: "/api/v1/office-frame/documents/doc-1/assets/a1?sig=s" });
  });

  it("refuses what the lane has no endpoint for, without pretending", async () => {
    const api = createDocsFrameApi();
    await expect(api.saveAs({ name: "x.docx", data: new ArrayBuffer(0) }, call)).rejects.toMatchObject({ code: "unsupported" });
    await expect(api.export({ format: "pdf" }, call)).rejects.toMatchObject({ code: "unsupported" });
    const added = await api.addAttachments({ files: [{ name: "a.pdf", mimeType: "application/pdf", data: new ArrayBuffer(1) }] }, call);
    expect(added.accepted).toEqual([]);
    expect(added.rejected).toHaveLength(1);
  });
});
