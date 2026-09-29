import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  createDocument,
  createDocumentFile,
  documentAssetPath,
  documentDownloadPath,
  downloadDocumentFile,
  getDocument,
  getDocumentAsset,
  getDocumentDownloadMeta,
  patchDocument,
  uploadDocumentAsset,
  uploadDocumentFile,
} from "./documents";
import {
  commitDocumentVersion,
  createDocumentVersion,
  getDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
} from "./documents-versions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "page",
  title: "Kế hoạch Q4",
  visibility: "workspace",
  revision: "41",
  current_version: 3,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
  ...over,
});

const versionBody = (over: Record<string, unknown> = {}) => ({
  id: "v1",
  document_id: "d1",
  version: 2,
  kind: "page",
  reason: "manual",
  size_bytes: 812,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-27T10:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { document: "x" }, null, [], "str"];

describe("documents endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  // ---- wire shape -------------------------------------------------------

  it("createDocument posts snake_case fields with the idempotency header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }));
    const out = await createDocument(
      "w1",
      { title: "Kế hoạch Q4", kind: "page", parent_id: "p1", content: { type: "doc" } },
      { idempotencyKey: "key-1" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("key-1");
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "Kế hoạch Q4",
      kind: "page",
      parent_id: "p1",
      content: { type: "doc" },
    });
    expect(out?.id).toBe("d1");
    expect(out?.revision).toBe("41");
  });

  it("patchDocument sends the base revision as a string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ revision: "42" }) }));
    const out = await patchDocument("d1", { revision: "41", title: "t" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ revision: "41", title: "t" });
    expect(out?.revision).toBe("42");
  });

  it("createDocumentFile posts multipart form data, not JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ kind: "file" }) }));
    const file = new Blob(["bytes"], { type: "application/pdf" });
    const out = await createDocumentFile("w1", file, { parent_id: "p1", title: "Báo cáo" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/files");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("parent_id")).toBe("p1");
    expect(form.get("title")).toBe("Báo cáo");
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull();
    expect(out?.kind).toBe("file");
  });

  it("uploadDocumentFile posts the file part only", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        upload_id: "f1",
        checksum_sha256: "abc",
        size_bytes: 5,
        claim_expires_at: "2026-09-28T09:00:00Z",
      }),
    );
    const out = await uploadDocumentFile("d1", new Blob(["bytes"]));
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/uploads");
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(out?.upload_id).toBe("f1");
  });

  it("commitDocumentVersion sends upload_id + base_revision with the key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ revision: "42" }), version: versionBody() }),
    );
    const out = await commitDocumentVersion(
      "d1",
      { upload_id: "f1", base_revision: "41" },
      { idempotencyKey: "key-9" },
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/versions/commit");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("key-9");
    expect(JSON.parse(String(init?.body))).toEqual({ upload_id: "f1", base_revision: "41" });
    expect(out?.document.revision).toBe("42");
    expect(out?.version.version).toBe(2);
  });

  it("listDocumentVersions maps next_cursor and joins pages by key prefix", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ versions: [versionBody()], next_cursor: "abc" }),
    );
    const out = await listDocumentVersions("d1", { cursor: "c0", limit: 50 });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/versions?cursor=c0&limit=50");
    expect(out.nextCursor).toBe("abc");
    expect(out.versions).toHaveLength(1);
  });

  it("restoreDocumentVersion posts to the version-scoped route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ revision: "43" }), version: versionBody({ reason: "restore" }) }),
    );
    const out = await restoreDocumentVersion("d1", 1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/versions/1/restore");
    expect(init?.method).toBe("POST");
    expect(out?.version.reason).toBe("restore");
    // A page restore sends no body; a file restore carries the base revision.
    expect(init?.body).toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: docBody({ revision: "44" }), version: versionBody({ reason: "restore" }) }),
    );
    await restoreDocumentVersion("d1", 1, { baseRevision: "43" });
    const [, initWithBase] = vi.mocked(fetch).mock.calls[1]!;
    expect(JSON.parse(String(initWithBase?.body))).toEqual({ base_revision: "43" });
  });

  it("getDocumentDownloadMeta requests meta=1 and keeps version", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        document_id: "d1",
        file: {
          file_id: "f2",
          version_id: "v2",
          version: 2,
          filename: "bao-cao.pdf",
          mime_type: "application/pdf",
          size_bytes: 250112,
          checksum_sha256: "abc",
        },
        disposition: "attachment",
      }),
    );
    const out = await getDocumentDownloadMeta("d1", 2);
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/download?version=2&meta=1");
    expect(out?.file.file_id).toBe("f2");
    expect(out?.disposition).toBe("attachment");
  });

  it("documentAssetPath and documentDownloadPath build the proxy routes", () => {
    expect(documentAssetPath("d1", "a1")).toBe("/api/v1/documents/d1/assets/a1");
    expect(documentDownloadPath("d1")).toBe("/api/v1/documents/d1/download");
    expect(documentDownloadPath("d1", 2)).toBe("/api/v1/documents/d1/download?version=2");
  });

  it("downloadDocumentFile and getDocumentAsset return blobs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const blob = await downloadDocumentFile("d1", 2);
    expect(blob.size).toBe(3);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([9])));
    const asset = await getDocumentAsset("d1", "a1");
    expect(asset.size).toBe(1);
  });

  // ---- malformed responses: one per endpoint -----------------------------
  // A mutation answer that cannot prove the write resolves null; the hook /
  // save machine turns it into "result not verifiable" and keeps dirty state.
  // Lists that cannot degrade safely throw so the query lands in error state.

  it.each(malformedBodies)("getDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocument("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("createDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(createDocument("w1", { title: "t" })).resolves.toBeNull();
  });

  it.each(malformedBodies)("patchDocument degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(patchDocument("d1", { revision: "41" })).resolves.toBeNull();
  });

  it.each(malformedBodies)("createDocumentFile degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(createDocumentFile("w1", new Blob(["x"]))).resolves.toBeNull();
  });

  it.each(malformedBodies)("uploadDocumentFile degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(uploadDocumentFile("d1", new Blob(["x"]))).resolves.toBeNull();
  });

  it.each(malformedBodies)("uploadDocumentAsset degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(uploadDocumentAsset("d1", new Blob(["x"]))).resolves.toBeNull();
  });

  it.each(malformedBodies)("getDocumentDownloadMeta degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentDownloadMeta("d1")).resolves.toBeNull();
  });

  it.each(malformedBodies)("listDocumentVersions throws rather than fake-empty %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(listDocumentVersions("d1")).rejects.toThrow("document_versions_invalid");
  });

  it.each(malformedBodies)("getDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentVersion("d1", 2)).resolves.toBeNull();
  });

  it.each(malformedBodies)("createDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(createDocumentVersion("d1", { label: "v" })).resolves.toBeNull();
  });

  it.each(malformedBodies)("commitDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(
      commitDocumentVersion("d1", { upload_id: "f1", base_revision: "41" }),
    ).resolves.toBeNull();
  });

  it.each(malformedBodies)("restoreDocumentVersion degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(restoreDocumentVersion("d1", 1)).resolves.toBeNull();
  });

  it("a document without revision is not a verifiable write", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: { id: "d1" } }));
    await expect(patchDocument("d1", { revision: "41" })).resolves.toBeNull();
  });

  it("a commit result without the version row is not verifiable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody() }));
    await expect(
      commitDocumentVersion("d1", { upload_id: "f1", base_revision: "41" }),
    ).resolves.toBeNull();
  });

  it("blob endpoints throw the server error, never a fake blob", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "forbidden", message: "no" } }, 403),
    );
    await expect(downloadDocumentFile("d1")).rejects.toMatchObject({
      name: "ApiError",
      code: "forbidden",
      status: 403,
    });
  });

  it("keeps lenient enum parsing: unknown reason/kind still parse", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ versions: [versionBody({ reason: "future_reason" })], next_cursor: null }),
    );
    const out = await listDocumentVersions("d1");
    expect(out.versions[0]?.reason).toBe("future_reason");
  });
});
