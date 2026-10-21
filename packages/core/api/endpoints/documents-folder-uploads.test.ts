import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileTarget } from "../../documents/folder-upload/transport";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  cancelFolderUpload,
  completeFolderUpload,
  createFolderUpload,
  createFolderUploadTransport,
  getFolderUpload,
} from "./documents-folder-uploads";

// UNI-2052, e6-server contract v0.2: the four JSON routes under
// /workspaces/{ws}/documents/folder-uploads. A fake fetch only.

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const FUTURE = "2999-01-01T00:00:00Z";

const wireBatch = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  status: "open",
  parent_id: "p1",
  root_folder_id: "r1",
  root_title: "Hồ sơ (1)",
  share_with_workspace: false,
  folders: [{ path: "", id: "r1" }, { path: "sub", id: "s1" }],
  files: [
    {
      file_key: "f-0001",
      path: "sub",
      filename: "a.pdf",
      size_bytes: 5,
      status: "pending",
      document_id: null,
      error: null,
      target: { kind: "put", method: "PUT", url: "https://s3.test/a", headers: { "Content-Type": "application/pdf" }, expires_at: FUTURE },
    },
  ],
  counts: { total: 1, done: 0, failed: 0, pending: 1 },
  total_bytes: 5,
  expires_at: FUTURE,
  created_at: "2026-10-21T01:00:00Z",
  ...over,
});

const planBody = {
  parent_id: "p1",
  root_name: "Hồ sơ",
  share_with_workspace: true,
  folders: ["sub"],
  files: [{ file_key: "f-0001", path: "sub", filename: "a.pdf", size_bytes: 5 }],
};

describe("documents folder-uploads endpoints", () => {
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

  it("createFolderUpload posts the plan with its Idempotency-Key and reads the batch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(wireBatch(), 201));
    const out = await createFolderUpload("w/1", planBody, { idempotencyKey: "k1" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w%2F1/documents/folder-uploads");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(String(init?.body))).toEqual(planBody);
    expect(out).toEqual(wireBatch());
  });

  it("createFolderUpload degrades a malformed answer to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ batch_id: 7 }, 201));
    await expect(createFolderUpload("w1", planBody, { idempotencyKey: "k" })).resolves.toBeNull();
  });

  it("reads drifted fields leniently: unknown statuses, bad targets, broken entries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        wireBatch({
          status: "archived",
          counts: "x",
          folders: [{ path: "", id: "r1" }, 42],
          files: [
            { file_key: "a", status: "weird", target: { kind: "teleport" } },
            { file_key: "b", status: "failed", error: { code: "size_mismatch", message: "m", reason: 3 }, target: null },
            { nope: true },
          ],
        }),
      ),
    );
    const out = await getFolderUpload("w1", "b1");
    expect(out?.status).toBe("open");
    expect(out?.counts).toEqual({ total: 0, done: 0, failed: 0, pending: 0 });
    expect(out?.folders).toEqual([{ path: "", id: "r1" }]);
    expect(out?.files).toEqual([
      { file_key: "a", path: "", filename: "", size_bytes: 0, status: "pending", document_id: null, error: null, target: null },
      {
        file_key: "b",
        path: "",
        filename: "",
        size_bytes: 0,
        status: "failed",
        document_id: null,
        error: { code: "size_mismatch", message: "m" },
        target: null,
      },
    ]);
  });

  it("reads a multipart target and a session put target", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        wireBatch({
          files: [
            {
              file_key: "m",
              status: "pending",
              target: {
                kind: "multipart",
                session_id: "s",
                part_size: 8,
                parts: [{ part_number: 1, url: "https://s3.test/p1", expires_at: FUTURE }],
                expires_at: FUTURE,
              },
            },
            {
              file_key: "c",
              status: "pending",
              target: { kind: "put", url: "/api/v1/x/content", auth: "session", expires_at: FUTURE },
            },
          ],
        }),
      ),
    );
    const out = await getFolderUpload("w1", "b1");
    expect(out?.files.map((f) => f.target)).toEqual([
      {
        kind: "multipart",
        session_id: "s",
        part_size: 8,
        parts: [{ part_number: 1, method: "PUT", url: "https://s3.test/p1", headers: {}, expires_at: FUTURE }],
        expires_at: FUTURE,
      },
      { kind: "put", method: "PUT", url: "/api/v1/x/content", headers: {}, expires_at: FUTURE, auth: "session" },
    ]);
  });

  it("getFolderUpload GETs the batch and degrades a malformed answer to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(wireBatch())).mockResolvedValueOnce(json([1, 2]));
    await expect(getFolderUpload("w1", "b/1")).resolves.toEqual(wireBatch());
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/folder-uploads/b%2F1",
    );
    await expect(getFolderUpload("w1", "b1")).resolves.toBeNull();
  });

  it("cancelFolderUpload DELETEs and degrades a malformed answer to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(wireBatch({ status: "canceled" }))).mockResolvedValueOnce(json("x"));
    await expect(cancelFolderUpload("w1", "b1")).resolves.toMatchObject({ status: "canceled" });
    expect(vi.mocked(fetch).mock.calls[0]![1]?.method).toBe("DELETE");
    await expect(cancelFolderUpload("w1", "b1")).resolves.toBeNull();
  });

  it("completeFolderUpload posts the items and reads per-file results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        results: [
          { file_key: "a", status: "done", document_id: "d1", error: null },
          { file_key: "b", status: "failed", document_id: null, error: { code: "unsupported_media", message: "m", reason: "zip" }, retryable: false },
          { file_key: "c", status: "done", document_id: null, error: null },
          { file_key: "d", status: "odd" },
          { file_key: "e", status: "failed", document_id: null, error: { code: "size_mismatch", message: "m" }, retryable: true },
          { file_key: "f", status: "failed", document_id: null, error: { code: "upload_missing", message: "m" }, retryable: "yes" },
        ],
        batch: { status: "completed", counts: { total: 4, done: 1, failed: 3, pending: 0 } },
      }),
    );
    const items = [{ file_key: "a", etag: '"e"' }, { file_key: "b", parts: [{ part_number: 1, etag: '"p"' }] }];
    const out = await completeFolderUpload("w1", "b1", items);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/folder-uploads/b1/complete");
    expect(JSON.parse(String(init?.body))).toEqual({ files: items });
    expect(out).toEqual({
      results: [
        { file_key: "a", status: "done", document_id: "d1", error: null },
        { file_key: "b", status: "failed", document_id: null, error: { code: "unsupported_media", message: "m", reason: "zip" }, retryable: false },
        { file_key: "c", status: "failed", document_id: null, error: { code: "unknown", message: "" }, retryable: true },
        { file_key: "d", status: "failed", document_id: null, error: { code: "unknown", message: "" } },
        { file_key: "e", status: "failed", document_id: null, error: { code: "size_mismatch", message: "m" }, retryable: true },
        // A malformed flag reads as absent: the runner's own rule decides.
        { file_key: "f", status: "failed", document_id: null, error: { code: "upload_missing", message: "m" } },
      ],
      batch: { status: "completed", counts: { total: 4, done: 1, failed: 3, pending: 0 } },
    });
  });

  it("completeFolderUpload degrades a malformed answer to no results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(null));
    await expect(completeFolderUpload("w1", "b1", [])).resolves.toEqual({
      results: [],
      batch: { status: "open", counts: { total: 0, done: 0, failed: 0, pending: 0 } },
    });
  });

  it("surfaces 422/429/409/410 as ApiError with code, fields and Retry-After", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ error: { code: "folder_upload_too_many_files", message: "x", fields: { max: 500, count: 612 } } }, 422))
      .mockResolvedValueOnce(json({ error: { code: "folder_uploads_busy", message: "x", fields: { retry_after: 30 } } }, 429, { "Retry-After": "30" }))
      .mockResolvedValueOnce(json({ error: { code: "folder_upload_canceled", message: "x" } }, 409))
      .mockResolvedValueOnce(json({ error: { code: "folder_upload_expired", message: "x" } }, 410));
    const errs = [
      await createFolderUpload("w1", planBody, { idempotencyKey: "k" }).catch((e: unknown) => e),
      await createFolderUpload("w1", planBody, { idempotencyKey: "k" }).catch((e: unknown) => e),
      await completeFolderUpload("w1", "b1", []).catch((e: unknown) => e),
      await getFolderUpload("w1", "b1").catch((e: unknown) => e),
    ] as ApiError[];
    for (const e of errs) expect(e).toBeInstanceOf(ApiError);
    expect(errs[0]).toMatchObject({ status: 422, code: "folder_upload_too_many_files", fields: { max: 500, count: 612 } });
    expect(errs[1]).toMatchObject({ status: 429, code: "folder_uploads_busy", retryAfterSeconds: 30 });
    expect(errs[2]).toMatchObject({ status: 409, code: "folder_upload_canceled" });
    expect(errs[3]).toMatchObject({ status: 410, code: "folder_upload_expired" });
  });

  it("createFolderUploadTransport throws on an answer with no batch", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({})));
    const transport = createFolderUploadTransport("w1");
    await expect(transport.plan(planBody, { idempotencyKey: "k" })).rejects.toThrow(/Malformed/);
    await expect(transport.status("b1")).rejects.toThrow(/Malformed/);
    await expect(transport.cancel("b1")).rejects.toThrow(/Malformed/);
  });

  it("createFolderUploadTransport routes every call through the workspace", async () => {
    vi.mocked(fetch).mockResolvedValue(json(wireBatch()));
    const transport = createFolderUploadTransport("w9");
    await transport.status("b1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/workspaces/w9/documents/folder-uploads/b1");
  });
});

describe("putToStorage through the transport", () => {
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

  const put = (target: FileTarget, blob: Blob, storedParts?: Map<number, string>) =>
    createFolderUploadTransport("w1").put(target, blob, { storedParts });

  it("PUTs a presigned target with its method and headers, no credentials, and reads the ETag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"abc"' } }));
    const blob = new Blob(["hello"]);
    const target: FileTarget = {
      kind: "put",
      method: "POST",
      url: "https://s3.test/obj",
      headers: { "Content-Type": "text/plain", Authorization: "Bearer leak" },
      expires_at: FUTURE,
    };
    await expect(put(target, blob)).resolves.toEqual({ etag: '"abc"' });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://s3.test/obj");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(blob);
    expect(init?.credentials).toBe("omit");
    expect(init?.headers).toEqual({ "Content-Type": "text/plain" });
  });

  it("fails a presigned PUT without an ETag as missing_etag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const target: FileTarget = { kind: "put", method: "PUT", url: "https://s3.test/o", headers: {}, expires_at: FUTURE };
    await expect(put(target, new Blob(["x"]))).rejects.toMatchObject({ name: "FolderUploadError", code: "missing_etag" });
  });

  it("surfaces a storage refusal as ApiError with its status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const target: FileTarget = { kind: "put", method: "PUT", url: "https://s3.test/o", headers: {}, expires_at: FUTURE };
    await expect(put(target, new Blob(["x"]))).rejects.toMatchObject({ name: "ApiError", status: 403 });
  });

  it("passes the abort signal through", async () => {
    vi.mocked(fetch).mockImplementationOnce(
      (_u, init) =>
        new Promise<Response>((_r, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const controller = new AbortController();
    const target: FileTarget = { kind: "put", method: "PUT", url: "https://s3.test/o", headers: {}, expires_at: FUTURE };
    const pending = createFolderUploadTransport("w1").put(target, new Blob(["x"]), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends a session target through the API with the bearer, header ETag first", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ etag: '"body"' }, 200, { ETag: '"head"' }));
    const blob = new Blob(["abc"]);
    const target: FileTarget = {
      kind: "put",
      method: "PUT",
      url: "/api/v1/workspaces/w1/documents/folder-uploads/b1/files/f/content",
      headers: { "Content-Type": "text/plain" },
      expires_at: FUTURE,
      auth: "session",
    };
    await expect(put(target, blob)).resolves.toEqual({ etag: '"head"' });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/workspaces/w1/documents/folder-uploads/b1/files/f/content");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(blob);
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("text/plain");
  });

  it("reads a session target's ETag from the body when the header is hidden", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ etag: '"body"' }));
    const target: FileTarget = { kind: "put", method: "PUT", url: "/api/v1/c", headers: {}, expires_at: FUTURE, auth: "session" };
    await expect(put(target, new Blob(["x"]))).resolves.toEqual({ etag: '"body"' });
  });

  it("fails a session target with a malformed body and no header as missing_etag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ etag: 5 }));
    const target: FileTarget = { kind: "put", method: "PUT", url: "/api/v1/c", headers: {}, expires_at: FUTURE, auth: "session" };
    await expect(put(target, new Blob(["x"]))).rejects.toMatchObject({ code: "missing_etag" });
  });

  it("refuses to send the bearer to a session target on another origin", async () => {
    const target: FileTarget = { kind: "put", method: "PUT", url: "https://evil.test/api/v1/c", headers: {}, expires_at: FUTURE, auth: "session" };
    await expect(put(target, new Blob(["x"]))).rejects.toMatchObject({ code: "untrusted_target" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["//evil.test/api/v1/c", "/\\evil.test/api/v1/c"])(
    "refuses a protocol-relative session target %s",
    async (url) => {
      const target: FileTarget = { kind: "put", method: "PUT", url, headers: {}, expires_at: FUTURE, auth: "session" };
      await expect(put(target, new Blob(["x"]))).rejects.toMatchObject({ code: "untrusted_target" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("treats an API-looking URL without auth as presigned: no bearer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: '"e"' } }));
    const target: FileTarget = { kind: "put", method: "PUT", url: "http://api.test/api/v1/c", headers: {}, expires_at: FUTURE };
    await put(target, new Blob(["x"]));
    expect(vi.mocked(fetch).mock.calls[0]![1]?.credentials).toBe("omit");
  });

  const multipart = (numbers: number[]): FileTarget => ({
    kind: "multipart",
    session_id: "s1",
    part_size: 4,
    expires_at: FUTURE,
    parts: numbers.map((n) => ({ part_number: n, method: "PUT", url: `https://s3.test/part${n}`, headers: {}, expires_at: FUTURE })),
  });

  it("sends a multipart target part by part and returns every part ETag", async () => {
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(new Response(null, { status: 200, headers: { ETag: `"${String(url).slice(-1)}"` } })),
    );
    await expect(put(multipart([1, 2, 3]), new Blob(["0123456789"]))).resolves.toEqual({
      parts: [
        { part_number: 1, etag: '"1"' },
        { part_number: 2, etag: '"2"' },
        { part_number: 3, etag: '"3"' },
      ],
    });
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => (init?.body as Blob).size)).toEqual([4, 4, 2]);
  });

  it("resumes a refreshed multipart target with only the missing parts", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response(null, { status: 200, headers: { ETag: '"new"' } })));
    const stored = new Map([[1, '"old1"'], [3, '"old3"']]);
    await expect(put(multipart([2]), new Blob(["0123456789"]), stored)).resolves.toEqual({
      parts: [
        { part_number: 1, etag: '"old1"' },
        { part_number: 2, etag: '"new"' },
        { part_number: 3, etag: '"old3"' },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips parts already stored when the same target is tried again", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response(null, { status: 200, headers: { ETag: '"new"' } })));
    const stored = new Map([[1, '"old1"']]);
    await expect(put(multipart([1, 2, 3]), new Blob(["0123456789"]), stored)).resolves.toEqual({
      parts: [
        { part_number: 1, etag: '"old1"' },
        { part_number: 2, etag: '"new"' },
        { part_number: 3, etag: '"new"' },
      ],
    });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["https://s3.test/part2", "https://s3.test/part3"]);
  });

  it("fails a multipart target that lacks the URL of a part", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response(null, { status: 200, headers: { ETag: '"e"' } })));
    await expect(put(multipart([1]), new Blob(["0123456789"]))).rejects.toMatchObject({ code: "missing_part_url" });
  });
});
