import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { createDocsFrameApi, docsFrameApiBase, docsFrameSrc, docsFrameToken, type DocsFrameCall } from "./docs-frame-api";

// The transport here is the frame client's fetch: injected, never the network.

const API = "http://api.test";
const DOC = {
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", title: "Plan", revision: "7", can_edit: true,
  file: { file_id: "f-1", version_id: "v-3", version: 3, filename: "Plan.docx", mime_type: "application/docx", size_bytes: 4, checksum_sha256: "abc" },
  download_url: "/api/v1/office-frame/documents/doc-1/content?version=3",
  updated_at: "2026-10-08T10:00:00Z",
};
const COMMITTED = { ...DOC, revision: "8", file: { ...DOC.file, version_id: "v-4", version: 4 } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Route = (init: RequestInit) => Response | Promise<Response>;
function fakeFetch(routes: Record<string, Route>) {
  const calls: { method: string; path: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).slice(API.length);
    const method = init.method ?? "GET";
    calls.push({ method, path, init });
    const route = routes[`${method} ${path}`];
    if (!route) throw new Error(`unexpected ${method} ${path}`);
    return route(init);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const call = (): DocsFrameCall => ({ workspaceId: "ws-1", documentId: "doc-1", token: "frame-tok", signal: new AbortController().signal });
const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

afterEach(() => { resetRuntimeConfig(); vi.unstubAllGlobals(); setAccessToken(null); });

describe("docs frame helpers", () => {
  it("builds the pinned same-origin frame URL and apiBase", () => {
    configureRuntime({ apiUrl: "https://api.uniwork.test" });
    expect(docsFrameSrc("1.2.0+abc")).toBe("/office-frame/docs/1.2.0%2Babc/index.html");
    expect(docsFrameApiBase()).toBe("https://api.uniwork.test/api/v1");
  });

  it("turns W6's token into the protocol's epoch-ms expiry", () => {
    const token = { token: "t", token_type: "Bearer", expires_at: "2026-10-08T10:10:00Z", expires_in: 600, document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true };
    expect(docsFrameToken(token)).toEqual({ token: "t", tokenExpiresAt: Date.parse("2026-10-08T10:10:00Z") });
    expect(docsFrameToken({ ...token, expires_at: "soon" }, 1_000)).toEqual({ token: "t", tokenExpiresAt: 601_000 });
  });
});

describe("createDocsFrameApi", () => {
  it("opens with the frame token only and hands the frame the bytes and the revision as etag", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      [`GET ${DOC.download_url}`]: () => new Response(new Uint8Array([1, 2, 3, 4])),
    });
    const opened = await createDocsFrameApi({ apiUrl: API, fetch }).open({ fileId: "doc-1" }, call());
    expect(opened.file).toEqual({
      fileId: "doc-1", name: "Plan.docx", sizeBytes: 4, mimeType: "application/docx", versionId: "v-3", etag: "7", writable: true,
      modifiedAt: Date.parse("2026-10-08T10:00:00Z"),
    });
    expect(opened.source.kind === "bytes" && new Uint8Array(opened.source.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
    for (const { init } of calls) {
      expect(header(init, "Authorization")).toBe("Bearer frame-tok");
      expect(init.credentials).toBe("omit");
    }
  });

  it("refuses a file the token is not scoped to without calling the API", async () => {
    const { fetch } = fakeFetch({});
    await expect(createDocsFrameApi({ apiUrl: API, fetch }).open({ fileId: "doc-2" }, call())).rejects.toMatchObject({ code: "forbidden" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("degrades a malformed open answer to a typed error", async () => {
    const { fetch } = fakeFetch({ "GET /api/v1/office-frame/documents/doc-1": () => json({ document_id: 42 }) });
    await expect(createDocsFrameApi({ apiUrl: API, fetch }).open({ fileId: "doc-1" }, call())).rejects.toMatchObject({ code: "internal" });
  });

  it("maps HTTP failures to protocol codes", async () => {
    const { fetch } = fakeFetch({ "GET /api/v1/office-frame/documents/doc-1": () => json({ error: { code: "token_expired", message: "expired" } }, 401) });
    await expect(createDocsFrameApi({ apiUrl: API, fetch }).open({ fileId: "doc-1" }, call())).rejects.toMatchObject({ code: "unauthorized", status: 401, details: { apiCode: "token_expired" } });
  });

  it("saves as upload + commit on the etag, each with an Idempotency-Key", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "2026-10-08T11:00:00Z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json(COMMITTED),
    });
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" }, call());
    expect(result).toMatchObject({ ok: true, versionId: "v-4", file: { etag: "8", versionId: "v-4" } });
    const [, upload, commit] = calls;
    expect((upload?.init.body as FormData).get("file")).toMatchObject({ name: "Plan.docx" });
    expect(upload?.init.body).toBeInstanceOf(FormData);
    expect(JSON.parse(String(commit?.init.body))).toEqual({ upload_id: "up-1", base_revision: "7" });
    expect(header(upload!.init, "Idempotency-Key")).toMatch(/:upload$/);
    expect(header(commit!.init, "Idempotency-Key")).toMatch(/:commit$/);
  });

  it("refuses a save with no etag instead of rebasing onto the newest revision", async () => {
    const { fetch, calls } = fakeFetch({});
    await expect(createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4) }, call())).rejects.toMatchObject({ code: "malformed" });
    expect(calls).toHaveLength(0);
  });

  it("derives one Idempotency-Key per logical save: a retry replays, another edit or base does not", async () => {
    const keysOf = async (bytes: number[], etag: string) => {
      const { fetch, calls } = fakeFetch({
        "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
        "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "z" }),
        "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json(COMMITTED),
      });
      await createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new Uint8Array(bytes).buffer, etag }, call());
      return [header(calls[1]!.init, "Idempotency-Key"), header(calls[2]!.init, "Idempotency-Key")];
    };
    const first = await keysOf([1, 2, 3], "7");
    expect(await keysOf([1, 2, 3], "7")).toEqual(first);
    expect(first[0]).not.toBe(first[1]);
    expect((await keysOf([1, 2, 4], "7"))[1]).not.toBe(first[1]);
    expect((await keysOf([1, 2, 3], "8"))[1]).not.toBe(first[1]);
  });

  it("answers a stale base (409 document_version_conflict) as a conflict, not a failure", async () => {
    const { fetch } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json({ error: { code: "document_version_conflict", message: "stale" } }, 409),
    });
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "6" }, call());
    expect(result).toMatchObject({ ok: false, error: { code: "conflict", status: 409, details: { apiCode: "document_version_conflict" } } });
  });

  it("fails a save whose commit answer is malformed", async () => {
    const { fetch } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json({ ok: true }),
    });
    await expect(createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" }, call())).rejects.toMatchObject({ code: "internal" });
  });

  it("lists recents, degrading a malformed answer to none", async () => {
    const ok = fakeFetch({ "GET /api/v1/office-frame/documents/doc-1/recents?limit=5": () => json({ items: [{ document_id: "doc-9", title: "Old.docx", updated_at: "2026-10-01T00:00:00Z" }] }) });
    await expect(createDocsFrameApi({ apiUrl: API, fetch: ok.fetch }).recents({ limit: 5 }, call())).resolves.toEqual({
      files: [{ fileId: "doc-9", name: "Old.docx", modifiedAt: Date.parse("2026-10-01T00:00:00Z") }],
    });
    const drifted = fakeFetch({ "GET /api/v1/office-frame/documents/doc-1/recents": () => json({ items: "nope" }) });
    await expect(createDocsFrameApi({ apiUrl: API, fetch: drifted.fetch }).recents({}, call())).resolves.toEqual({ files: [] });
  });

  it("has no image-upload handler: the frame embeds data: URIs and an asset URL on the API origin could not load under img-src 'self'", () => {
    expect((createDocsFrameApi() as unknown as Record<string, unknown>).uploadImage).toBeUndefined();
  });

  it("offers no attachments until their route exists", () => {
    expect(createDocsFrameApi().addAttachments).toBeUndefined();
  });

  describe("export", () => {
    const EXPORT = "POST /api/v1/office-frame/documents/doc-1/export/pdf";
    const pdfAnswer = () => new Response("%PDF-1.7 x", { headers: { "Content-Type": "application/pdf" } });

    it("renders the live bytes when the frame sends them, named after the document", async () => {
      const { fetch, calls } = fakeFetch({ [EXPORT]: pdfAnswer });
      const out = await createDocsFrameApi({ apiUrl: API, fetch }).export!({ format: "pdf", fileId: "doc-1", data: new ArrayBuffer(3), name: "Plan.docx" }, call());
      expect(out.mimeType).toBe("application/pdf");
      expect(out.name).toBe("Plan.pdf");
      expect(new TextDecoder().decode(out.data)).toBe("%PDF-1.7 x");
      const form = calls[0]!.init.body as FormData;
      expect(form.get("file")).toBeInstanceOf(Blob);
      expect(header(calls[0]!.init, "Idempotency-Key")).toBeTruthy();
      expect(header(calls[0]!.init, "Authorization")).toBe("Bearer frame-tok");
    });

    it("keys one export by what is exported: a retry replays, other bytes do not", async () => {
      const keyOf = async (bytes: number[]) => {
        const { fetch, calls } = fakeFetch({ [EXPORT]: pdfAnswer });
        await createDocsFrameApi({ apiUrl: API, fetch }).export!({ format: "pdf", data: new Uint8Array(bytes).buffer, name: "Plan.docx" }, call());
        return header(calls[0]!.init, "Idempotency-Key");
      };
      expect(await keyOf([1, 2])).toBe(await keyOf([1, 2]));
      expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 3]));
    });

    it("renders the stored version when there are no unsaved bytes", async () => {
      const { fetch, calls } = fakeFetch({ [EXPORT]: pdfAnswer });
      const out = await createDocsFrameApi({ apiUrl: API, fetch }).export!({ format: "pdf", fileId: "doc-1" }, call());
      expect(out.name).toBeUndefined();
      expect([...(calls[0]!.init.body as FormData).keys()]).toEqual([]);
    });

    it("maps 501 to unsupported (the frame prints instead), 504 to timeout and 413 to too_large", async () => {
      const answers: Record<string, Response> = {
        501: json({ error: { code: "unsupported_operation", message: "no renderer" } }, 501),
        504: new Response("", { status: 504 }),
        413: json({ error: { code: "payload_too_large", message: "big" } }, 413),
      };
      for (const [status, code] of [["501", "unsupported"], ["504", "timeout"], ["413", "too_large"]] as const) {
        const { fetch } = fakeFetch({ [EXPORT]: () => answers[status]! });
        await expect(createDocsFrameApi({ apiUrl: API, fetch }).export!({ format: "pdf" }, call())).rejects.toMatchObject({ code, status: Number(status) });
      }
    });

    it("treats 503 office_not_configured (no engine at all) like 501, but not any other 503", async () => {
      const notConfigured = fakeFetch({ [EXPORT]: () => json({ error: { code: "office_not_configured", message: "office engine is not configured" } }, 503) });
      await expect(createDocsFrameApi({ apiUrl: API, fetch: notConfigured.fetch }).export!({ format: "pdf" }, call())).rejects.toMatchObject({ code: "unsupported", status: 503 });
      const down = fakeFetch({ [EXPORT]: () => json({ error: { code: "unavailable", message: "down" } }, 503) });
      await expect(createDocsFrameApi({ apiUrl: API, fetch: down.fetch }).export!({ format: "pdf" }, call())).rejects.toMatchObject({ code: "internal", status: 503 });
    });

    it("fails a 200 that is not a PDF, refuses HTML and another document, without guessing", async () => {
      const drifted = fakeFetch({ [EXPORT]: () => json({ ok: true }) });
      const api = createDocsFrameApi({ apiUrl: API, fetch: drifted.fetch });
      await expect(api.export!({ format: "pdf" }, call())).rejects.toMatchObject({ code: "internal" });
      await expect(api.export!({ format: "html", html: "<p/>" }, call())).rejects.toMatchObject({ code: "unsupported" });
      await expect(api.export!({ format: "pdf", fileId: "doc-2" }, call())).rejects.toMatchObject({ code: "forbidden" });
      expect(drifted.calls).toHaveLength(1);
    });
  });
});

describe("createDocsFrameApi saveAs", () => {
  // Save-as runs on the host's session (POST documents/files, then a frame
  // token for the copy), so the session transport and the frame client share
  // one fake fetch.
  const COPY = {
    id: "doc-2", organization_id: "org-1", workspace_id: "ws-1", parent_id: null, kind: "file", title: "Copy",
    visibility: "workspace", revision: "1", current_version: 1, position: 0, created_by: "u1", created_by_kind: "human",
    updated_by: "u1", updated_by_kind: "human", created_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:00:00Z",
  };
  const COPY_TOKEN = {
    token: "copy-tok", token_type: "Bearer", expires_at: "2026-10-08T10:10:00Z", expires_in: 600,
    document_id: "doc-2", workspace_id: "ws-1", organization_id: "org-1", can_edit: true,
  };
  const OPENED = { ...DOC, document_id: "doc-2", title: "Copy", revision: "1", file: { ...DOC.file, filename: "Copy.docx", version_id: "v-c1" } };

  function setup(routes: Record<string, Route>) {
    configureRuntime({ apiUrl: API });
    setAccessToken("session-tok");
    const fake = fakeFetch(routes);
    vi.stubGlobal("fetch", fake.fetch);
    return { ...fake, api: createDocsFrameApi({ apiUrl: API, fetch: fake.fetch }) };
  }

  it("creates the copy with the session, mints a token for it and answers with its open shape", async () => {
    const { api, calls } = setup({
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
      "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
    });
    const result = await api.saveAs!({ name: "Copy", data: new ArrayBuffer(4) }, call());
    expect(result.save).toEqual({
      ok: true, versionId: "v-c1",
      file: expect.objectContaining({ fileId: "doc-2", name: "Copy.docx", etag: "1", writable: true }),
    });
    expect(result.rebind).toEqual({ documentId: "doc-2", token: COPY_TOKEN });
    const [create, mint, open] = calls;
    const form = create!.init.body as FormData;
    expect((form.get("file") as File).name).toBe("Copy.docx");
    expect(form.get("title")).toBe("Copy");
    expect(new Headers(create!.init.headers).get("Idempotency-Key")).toBeTruthy();
    expect(new Headers(create!.init.headers).get("Authorization")).toBe("Bearer session-tok");
    expect(new Headers(mint!.init.headers).get("Authorization")).toBe("Bearer session-tok");
    expect(header(open!.init, "Authorization")).toBe("Bearer copy-tok");
  });

  it("keys one save-as by workspace, name and bytes, so a retry replays the same copy", async () => {
    const keyOf = async (bytes: number[], name = "Copy") => {
      const { api, calls } = setup({
        "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
        "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
        "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
      });
      await api.saveAs!({ name, data: new Uint8Array(bytes).buffer }, call());
      return new Headers(calls[0]!.init.headers).get("Idempotency-Key");
    };
    expect(await keyOf([1, 2])).toBe(await keyOf([1, 2]));
    expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 3]));
    expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 2], "Other"));
  });

  it("degrades a malformed create or mint answer to a typed error", async () => {
    const drifted = setup({ "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: { id: 7 } }) });
    await expect(drifted.api.saveAs!({ name: "Copy.docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "internal" });

    const noToken = setup({
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json({ token: "" }),
    });
    await expect(noToken.api.saveAs!({ name: "Copy.docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "internal" });
  });

  it("maps a refused create to the protocol code", async () => {
    const { api } = setup({ "POST /api/v1/workspaces/ws-1/documents/files": () => json({ error: { code: "quota_exceeded", message: "full" } }, 413) });
    await expect(api.saveAs!({ name: "Big.docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "too_large", status: 413 });
  });
});
