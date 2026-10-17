import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  abortFrameUploadSession,
  abortUploadSession,
  completeFrameUploadSession,
  completeUploadSession,
  createDocumentUploadSession,
  createFrameUploadSession,
  createWorkspaceUploadSession,
  getFrameUploadSession,
  getUploadSession,
  putUploadSessionPart,
} from "./documents-upload-sessions";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const probe = {
  head_b64: "UEsDBBQAAAAIAA==",
  central_dir_b64: "UEsBAhQAAAAIAA==",
  cd_offset: 83820000,
  cd_size: 66080,
};

const sessionWire = {
  session_id: "01JA09K3N1P2Q3R4S5T6U7V8",
  part_size: 8388608,
  total_parts: 3,
  completed_parts: [{ part_number: 1, etag: '"etag-1"', size: 8388608 }],
  parts: [
    {
      part_number: 2,
      method: "PUT",
      url: "https://s3.test/bucket/key?partNumber=2&uploadId=u1",
      headers: { "x-amz-Expected-Bucket-Owner": "123" },
      expires_at: "2026-10-17T16:00:00Z",
    },
  ],
  expires_at: "2026-10-18T15:00:00Z",
};

const docBody = {
  id: "doc-1",
  organization_id: "org-1",
  workspace_id: "ws-1",
  parent_id: "folder-1",
  kind: "file",
  title: "Report.docx",
  visibility: "restricted",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u-1",
  created_by_kind: "human",
  updated_by: "u-1",
  updated_by_kind: "human",
  created_at: "2026-10-17T12:00:00Z",
  updated_at: "2026-10-17T12:00:00Z",
};

const uploadBody = {
  upload_id: "file-1",
  checksum_sha256: "abc123def456",
  size_bytes: 25165824,
  claim_expires_at: "2026-10-18T12:00:00Z",
};

const malformedBodies = [{ nope: true }, null, [], "malformed", { session_id: "" }, { session_id: "s1", part_size: "bad" }];


type XhrListener = (event?: { loaded: number }) => void;

/** Minimal XMLHttpRequest fake: records headers, lets a test drive the events. */
class FakeXhr {
  static last: FakeXhr | null = null;
  status = 0;
  statusText = "";
  responseText = "";
  rawHeaders = "";
  withCredentials = false;
  sent = false;
  aborted = false;
  setHeaders: Record<string, string> = {};
  listeners: Record<string, XhrListener[]> = {};
  upload = { addEventListener: vi.fn() };
  constructor() {
    FakeXhr.last = this;
  }
  open = vi.fn();
  setRequestHeader(k: string, v: string) {
    this.setHeaders[k] = v;
  }
  addEventListener(name: string, fn: XhrListener) {
    (this.listeners[name] ??= []).push(fn);
  }
  getAllResponseHeaders() {
    return this.rawHeaders;
  }
  send() {
    this.sent = true;
  }
  abort() {
    this.aborted = true;
    this.fire("abort");
  }
  fire(name: string) {
    for (const fn of this.listeners[name] ?? []) fn();
  }
}

describe("documents upload sessions endpoints", () => {
  beforeEach(() => {
    setAccessToken("session-jwt");
    configureRuntime({ apiUrl: "http://api.test" });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
    resetRuntimeConfig();
  });

  it("createWorkspaceUploadSession posts to workspace route with Idempotency-Key and session bearer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(sessionWire, 201));
    const out = await createWorkspaceUploadSession(
      "ws-1",
      {
        filename: "Report.docx",
        size_bytes: 25165824,
        parent_id: "folder-1",
        title: "Báo cáo Q4",
        visibility: "restricted",
        probe,
      },
      { idempotencyKey: "idem-ws-1" },
    );
    expect(out).toEqual(sessionWire);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/ws-1/documents/upload-sessions");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBe("idem-ws-1");
    expect(headers.get("Authorization")).toBe("Bearer session-jwt");
    expect(JSON.parse(String(init?.body))).toEqual({
      filename: "Report.docx",
      size_bytes: 25165824,
      parent_id: "folder-1",
      title: "Báo cáo Q4",
      visibility: "restricted",
      probe,
    });
  });

  it("createDocumentUploadSession posts to document route with Idempotency-Key and session bearer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(sessionWire, 201));
    const out = await createDocumentUploadSession(
      "doc-1",
      { filename: "Report.docx", size_bytes: 25165824, probe },
      { idempotencyKey: "idem-doc-1" },
    );
    expect(out).toEqual(sessionWire);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/doc-1/upload-sessions");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBe("idem-doc-1");
    expect(headers.get("Authorization")).toBe("Bearer session-jwt");
    expect(JSON.parse(String(init?.body))).toEqual({
      filename: "Report.docx",
      size_bytes: 25165824,
      probe,
    });
  });

  it("createFrameUploadSession posts to office-frame route with frame token only and credentials omit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(sessionWire, 201));
    const out = await createFrameUploadSession(
      "doc-1",
      { filename: "Report.docx", size_bytes: 25165824, probe },
      { frameToken: "oft1.frame-token", idempotencyKey: "idem-frame-1" },
    );
    expect(out).toEqual(sessionWire);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/office-frame/documents/doc-1/upload-sessions");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer oft1.frame-token");
    expect(headers.get("Idempotency-Key")).toBe("idem-frame-1");
    expect(JSON.parse(String(init?.body))).toEqual({
      filename: "Report.docx",
      size_bytes: 25165824,
      probe,
    });
  });

  it("getUploadSession and getFrameUploadSession read status, completed_parts, and missing parts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...sessionWire, status: "open" }, 200));
    const s1 = await getUploadSession("sess-1");
    expect(s1).toEqual({ ...sessionWire, status: "open" });
    const [url1, init1] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url1)).toBe("http://api.test/api/v1/upload-sessions/sess-1");
    expect(init1?.method).toBe("GET");
    expect(new Headers(init1?.headers).get("Authorization")).toBe("Bearer session-jwt");

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        session_id: "sess-2",
        status: "validating",
        part_size: 8388608,
        total_parts: 3,
        completed_parts: [],
        expires_at: "2026-10-18T15:00:00Z",
      }),
    );
    const s2 = await getFrameUploadSession("doc-1", "sess-2", { frameToken: "oft1.frame-token" });
    expect(s2?.status).toBe("validating");
    expect(s2?.parts).toEqual([]);
    const [url2, init2] = vi.mocked(fetch).mock.calls[1]!;
    expect(String(url2)).toBe("http://api.test/api/v1/office-frame/documents/doc-1/upload-sessions/sess-2");
    expect(init2?.method).toBe("GET");
    expect(init2?.credentials).toBe("omit");
    expect(new Headers(init2?.headers).get("Authorization")).toBe("Bearer oft1.frame-token");
  });

  it("completeUploadSession parses both DocumentSDO (workspace) and DocumentUploadSDO (version)", async () => {
    const parts = [
      { part_number: 1, etag: '"e1"' },
      { part_number: 2, etag: '"e2"' },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody }, 200));
    const docRes = await completeUploadSession("sess-ws", { parts });
    expect(docRes?.kind).toBe("document");
    if (docRes?.kind === "document") {
      expect(docRes.document.id).toBe("doc-1");
    }
    const [url1, init1] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url1)).toBe("http://api.test/api/v1/upload-sessions/sess-ws/complete");
    expect(init1?.method).toBe("POST");
    expect(JSON.parse(String(init1?.body))).toEqual({ parts });

    vi.mocked(fetch).mockResolvedValueOnce(json(uploadBody, 200));
    const verRes = await completeUploadSession("sess-ver", { parts });
    expect(verRes).toEqual({ kind: "upload", upload: uploadBody });
  });

  it("completeFrameUploadSession posts parts with frame token and parses DocumentUploadSDO", async () => {
    const parts = [{ part_number: 1, etag: '"e1"' }];
    vi.mocked(fetch).mockResolvedValueOnce(json(uploadBody, 200));
    const out = await completeFrameUploadSession("doc-1", "sess-frame", { parts }, { frameToken: "oft1.frame-token" });
    expect(out).toEqual(uploadBody);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/office-frame/documents/doc-1/upload-sessions/sess-frame/complete");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer oft1.frame-token");
    expect(JSON.parse(String(init?.body))).toEqual({ parts });
  });

  it("abortUploadSession and abortFrameUploadSession send DELETE and resolve on 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(abortUploadSession("sess-1")).resolves.toBeUndefined();
    const [url1, init1] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url1)).toBe("http://api.test/api/v1/upload-sessions/sess-1");
    expect(init1?.method).toBe("DELETE");
    expect(new Headers(init1?.headers).get("Authorization")).toBe("Bearer session-jwt");

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      abortFrameUploadSession("doc-1", "sess-2", { frameToken: "oft1.frame-token" }),
    ).resolves.toBeUndefined();
    const [url2, init2] = vi.mocked(fetch).mock.calls[1]!;
    expect(String(url2)).toBe("http://api.test/api/v1/office-frame/documents/doc-1/upload-sessions/sess-2");
    expect(init2?.method).toBe("DELETE");
    expect(init2?.credentials).toBe("omit");
    expect(new Headers(init2?.headers).get("Authorization")).toBe("Bearer oft1.frame-token");
  });

  it("putUploadSessionPart PUTs directly to presigned URL with credentials omit, no Authorization header, and reads ETag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { ETag: '"part-etag-1"' } }),
    );
    const partBlob = new Blob(["part-bytes"]);
    const etag = await putUploadSessionPart(
      "https://s3.example.test/bucket/obj?partNumber=1&X-Amz-Signature=sig",
      partBlob,
      { headers: { "x-amz-checksum-sha256": "abc" } },
    );
    expect(etag).toBe('"part-etag-1"');
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("https://s3.example.test/bucket/obj?partNumber=1&X-Amz-Signature=sig");
    expect(init?.method).toBe("PUT");
    expect(init?.credentials).toBe("omit");
    expect(init?.body).toBe(partBlob);
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("x-amz-checksum-sha256")).toBe("abc");
  });

  it("does not set the signed Host header on the XHR part PUT", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const p = putUploadSessionPart("https://s3.example.test/part", new Blob(["x"]), {
      onProgress: () => {},
      headers: { Host: "s3.example.test", Authorization: "Bearer x", "x-amz-checksum-sha256": "abc" },
    });
    const xhr = FakeXhr.last!;
    xhr.status = 200;
    xhr.rawHeaders = 'ETag: "e1"';
    xhr.fire("load");
    await expect(p).resolves.toBe('"e1"');
    expect(xhr.setHeaders).toEqual({ "x-amz-checksum-sha256": "abc" });
  });

  it("surfaces Retry-After and fields on failed responses as ApiError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        { error: { code: "upload_session_busy", message: "busy", fields: { retry_after: 5 } } },
        409,
        { "Retry-After": "7" },
      ),
    );
    const err = await completeUploadSession("sess-1", { parts: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      code: "upload_session_busy",
      retryAfterSeconds: 7,
      fields: { retry_after: 5 },
    });
  });

  it("degrades malformed responses across all 9 upload session endpoints and part PUT instead of throwing", async () => {
    for (const bad of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 201));
      await expect(
        createWorkspaceUploadSession(
          "ws-1",
          { filename: "a.docx", size_bytes: 25_000_000, probe },
          { idempotencyKey: "k" },
        ),
      ).resolves.toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 201));
      await expect(
        createDocumentUploadSession(
          "doc-1",
          { filename: "a.docx", size_bytes: 25_000_000, probe },
          { idempotencyKey: "k" },
        ),
      ).resolves.toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 201));
      await expect(
        createFrameUploadSession(
          "doc-1",
          { filename: "a.docx", size_bytes: 25_000_000, probe },
          { frameToken: "tok", idempotencyKey: "k" },
        ),
      ).resolves.toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 200));
      await expect(getUploadSession("sess-1")).resolves.toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 200));
      await expect(getFrameUploadSession("doc-1", "sess-1", { frameToken: "tok" })).resolves.toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 200));
      await expect(completeUploadSession("sess-1", { parts: [] })).resolves.toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 200));
      await expect(
        completeFrameUploadSession("doc-1", "sess-1", { parts: [] }, { frameToken: "tok" }),
      ).resolves.toBeNull();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 200));
      await expect(abortUploadSession("sess-1")).resolves.toBeUndefined();

      vi.mocked(fetch).mockResolvedValueOnce(json(bad, 200));
      await expect(
        abortFrameUploadSession("doc-1", "sess-1", { frameToken: "tok" }),
      ).resolves.toBeUndefined();
    }

    // Missing or blank ETag header on a 200 part PUT degrades to null.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(putUploadSessionPart("https://s3.example.test/part", new Blob(["x"]))).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200, headers: { ETag: "   " } }));
    await expect(putUploadSessionPart("https://s3.example.test/part", new Blob(["x"]))).resolves.toBeNull();
  });
});
