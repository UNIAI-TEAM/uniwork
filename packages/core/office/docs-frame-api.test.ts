import { afterEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { createDocsFrameApi, createOfficeFrameSourceApi, docsFrameApiBase, docsFrameSrc, docsFrameToken, type DocsFrameCall } from "./docs-frame-api";

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

  it("commits with the host's edit lock id when the call carries one (UNI-1645)", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "2026-10-08T11:00:00Z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json(COMMITTED),
    });
    await createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" }, { ...call(), editLockId: "lock-1" });
    const commit = calls.find((c) => c.path.endsWith("/versions/commit"));
    expect(JSON.parse(String(commit?.init.body))).toEqual({ upload_id: "up-1", base_revision: "7", edit_lock_id: "lock-1" });
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

  it("commit 423 document_locked -> readOnly refusal, never {ok:false} (UNI-1645)", async () => {
    const fields = { holder_id: "u2", holder_name: "An", since: "2026-10-15T03:12:00Z", expires_at: "2026-10-15T03:14:00Z", held_by_me: false, current_revision: "8" };
    const { fetch } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json({ error: { code: "document_locked", message: "đang sửa", fields } }, 423),
    });
    const saving = createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" }, { ...call(), editLockId: "lock-1" });
    await expect(saving).rejects.toMatchObject({ code: "forbidden", status: 423, message: "document_locked (HTTP 423)", details: { apiCode: "document_locked", fields } });
  });

  it("hands the frame a stable code, never the server's account-language sentence", async () => {
    const { fetch } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 4, claim_expires_at: "z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json({ error: { code: "document_version_conflict", message: "tài liệu đã có phiên bản mới hơn kể từ lần bạn mở nó" } }, 409),
    });
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "6" }, call());
    expect(result).toMatchObject({ ok: false, error: { code: "conflict", message: "document_version_conflict (HTTP 409)", details: { apiCode: "document_version_conflict" } } });
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
    await expect(createDocsFrameApi({ apiUrl: API, fetch: ok.fetch }).recents?.({ limit: 5 }, call())).resolves.toEqual({
      files: [{ fileId: "doc-9", name: "Old.docx", modifiedAt: Date.parse("2026-10-01T00:00:00Z") }],
    });
    const drifted = fakeFetch({ "GET /api/v1/office-frame/documents/doc-1/recents": () => json({ items: "nope" }) });
    await expect(createDocsFrameApi({ apiUrl: API, fetch: drifted.fetch }).recents?.({}, call())).resolves.toEqual({ files: [] });
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

  it("creates the copy next to its source, mints a token for it and answers with its open shape", async () => {
    const { api, calls } = setup({
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: "folder-src" } }),
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
    const [read, create, mint, open] = calls;
    expect(read!.path).toBe("/api/v1/documents/doc-1");
    const form = create!.init.body as FormData;
    expect((form.get("file") as File).name).toBe("Copy.docx");
    expect(form.get("title")).toBe("Copy");
    // The copy lands beside the source document, not at the workspace root (UNI-1847 D6).
    expect(form.get("parent_id")).toBe("folder-src");
    expect(form.get("destination")).toBeNull();
    expect(new Headers(create!.init.headers).get("Idempotency-Key")).toBeTruthy();
    expect(new Headers(create!.init.headers).get("Authorization")).toBe("Bearer session-tok");
    expect(new Headers(mint!.init.headers).get("Authorization")).toBe("Bearer session-tok");
    expect(header(open!.init, "Authorization")).toBe("Bearer copy-tok");
  });

  it("places the copy of a root document into My Folder instead of the workspace root (UNI-1847 D6)", async () => {
    const MY_FOLDER = { id: "mf-1", organization_id: "org-1", workspace_id: "ws-1", parent_id: null, kind: "folder", system_kind: "my_folder", title: "My Folder", visibility: "restricted", revision: "1" };
    const { api, calls } = setup({
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: null } }),
      "POST /api/v1/workspaces/ws-1/documents/my-folder": () => json({ document: MY_FOLDER }),
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
      "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
    });
    const result = await api.saveAs!({ name: "Copy", data: new ArrayBuffer(4) }, call());
    expect(result.rebind.documentId).toBe("doc-2");
    expect(calls.some((c) => c.path === "/api/v1/workspaces/ws-1/documents/my-folder")).toBe(true);
    const create = calls.find((c) => c.path === "/api/v1/workspaces/ws-1/documents/files")!;
    const form = create.init.body as FormData;
    expect(form.get("parent_id")).toBe("mf-1");
    expect(form.get("destination")).toBeNull();
  });

  it("lets an explicit folderId win without reading the source (its folder picker chose)", async () => {
    const { api, calls } = setup({
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
      "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
    });
    await api.saveAs!({ name: "Copy", folderId: "folder-picked", data: new ArrayBuffer(4) }, call());
    expect(calls.some((c) => c.path === "/api/v1/documents/doc-1")).toBe(false);
    const create = calls.find((c) => c.path === "/api/v1/workspaces/ws-1/documents/files")!;
    expect((create.init.body as FormData).get("parent_id")).toBe("folder-picked");
  });

  it("keys one save-as by workspace, name and bytes, so a retry replays the same copy", async () => {
    const keyOf = async (bytes: number[], name = "Copy") => {
      const { api, calls } = setup({
        "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: null } }),
        "POST /api/v1/workspaces/ws-1/documents/my-folder": () => json({ document: { id: "mf-1", workspace_id: "ws-1", kind: "folder", title: "My Folder", revision: "1", system_kind: "my_folder" } }),
        "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
        "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
        "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
      });
      await api.saveAs!({ name, data: new Uint8Array(bytes).buffer }, call());
      const create = calls.find((c) => c.path === "/api/v1/workspaces/ws-1/documents/files")!;
      return new Headers(create.init.headers).get("Idempotency-Key");
    };
    expect(await keyOf([1, 2])).toBe(await keyOf([1, 2]));
    expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 3]));
    expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 2], "Other"));
  });

  it("degrades a malformed create or mint answer to a typed error", async () => {
    const drifted = setup({
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: null } }),
      "POST /api/v1/workspaces/ws-1/documents/my-folder": () => json({ document: { id: "mf-1", workspace_id: "ws-1", kind: "folder", title: "My Folder", revision: "1", system_kind: "my_folder" } }),
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: { id: 7 } }),
    });
    await expect(drifted.api.saveAs!({ name: "Copy.docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "internal" });

    const noToken = setup({
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: null } }),
      "POST /api/v1/workspaces/ws-1/documents/my-folder": () => json({ document: { id: "mf-1", workspace_id: "ws-1", kind: "folder", title: "My Folder", revision: "1", system_kind: "my_folder" } }),
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json({ token: "" }),
    });
    await expect(noToken.api.saveAs!({ name: "Copy.docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "internal" });
  });

  it("maps a refused create to the protocol code", async () => {
    const { api } = setup({
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: null } }),
      "POST /api/v1/workspaces/ws-1/documents/my-folder": () => json({ document: { id: "mf-1", workspace_id: "ws-1", kind: "folder", title: "My Folder", revision: "1", system_kind: "my_folder" } }),
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ error: { code: "quota_exceeded", message: "full" } }, 413),
    });
    await expect(api.saveAs!({ name: "Big.docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "too_large", status: 413 });
  });

  it("preserves fields.max_bytes on a 413 file_too_large save or saveAs failure", async () => {
    const { api } = setup({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: "folder-src" } }),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () =>
        json({ error: { code: "file_too_large", message: "too big", fields: { max_bytes: 209715200 } } }, 413),
      "POST /api/v1/workspaces/ws-1/documents/files": () =>
        json({ error: { code: "file_too_large", message: "too big", fields: { max_bytes: 104857600 } } }, 413),
    });
    await expect(api.save({ fileId: "doc-1", data: new ArrayBuffer(4), etag: "7" }, call())).rejects.toMatchObject({
      code: "too_large",
      status: 413,
      details: { apiCode: "file_too_large", max_bytes: 209715200 },
    });
    await expect(api.saveAs!({ name: "Big.docx", data: new ArrayBuffer(4) }, call())).rejects.toMatchObject({
      code: "too_large",
      status: 413,
      details: { apiCode: "file_too_large", max_bytes: 104857600 },
    });
  });
});

describe("createDocsFrameApi chunked upload sessions above threshold (UNI-1863)", () => {
  const THRESHOLD = 8;
  const OVER_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer;
  const AT_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  const COPY = {
    id: "doc-2", organization_id: "org-1", workspace_id: "ws-1", parent_id: "folder-9", kind: "file", title: "Copy",
    visibility: "workspace", revision: "1", current_version: 1, position: 0, created_by: "u1", created_by_kind: "human",
    updated_by: "u1", updated_by_kind: "human", created_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:00:00Z",
  };
  const COPY_TOKEN = {
    token: "copy-tok", token_type: "Bearer", expires_at: "2026-10-08T10:10:00Z", expires_in: 600,
    document_id: "doc-2", workspace_id: "ws-1", organization_id: "org-1", can_edit: true,
  };
  const OPENED = { ...DOC, document_id: "doc-2", title: "Copy", revision: "1", file: { ...DOC.file, filename: "Copy.docx", version_id: "v-c1" } };
  const sessionBody = (sessionId: string, prefix: string) => ({
    session_id: sessionId, part_size: 8, total_parts: 2, completed_parts: [], expires_at: "2099-01-01T00:00:00Z",
    parts: [
      { part_number: 1, method: "PUT", url: `${API}/s3/${prefix}-1`, headers: {}, expires_at: "2099-01-01T00:00:00Z" },
      { part_number: 2, method: "PUT", url: `${API}/s3/${prefix}-2`, headers: {}, expires_at: "2099-01-01T00:00:00Z" },
    ],
  });
  const partOk = (etag: string) => () => new Response(null, { status: 200, headers: { ETag: etag } });

  it("routes a save above the threshold through the frame upload-session routes and commits with upload_id, base_revision and edit_lock_id", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/upload-sessions": () => json(sessionBody("sess-f1", "fpart"), 201),
      "PUT /s3/fpart-1": partOk('"e1"'),
      "PUT /s3/fpart-2": partOk('"e2"'),
      "POST /api/v1/office-frame/documents/doc-1/upload-sessions/sess-f1/complete": () =>
        json({ upload_id: "up-sess-1", checksum_sha256: "abc", size_bytes: 12, claim_expires_at: "2026-10-08T11:00:00Z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json(COMMITTED),
    });
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).save(
      { fileId: "doc-1", data: OVER_BYTES, etag: "7" },
      { ...call(), editLockId: "lock-1", chunkedUploadThresholdBytes: THRESHOLD },
    );
    expect(result).toMatchObject({ ok: true, versionId: "v-4", file: { etag: "8", versionId: "v-4" } });
    expect(calls.some((c) => c.path.endsWith("/uploads"))).toBe(false);
    const createSess = calls.find((c) => c.path === "/api/v1/office-frame/documents/doc-1/upload-sessions")!;
    expect(header(createSess.init, "Authorization")).toBe("Bearer frame-tok");
    expect(header(createSess.init, "Idempotency-Key")).toMatch(/^frame-save-.*:upload$/);
    expect(JSON.parse(String(createSess.init.body))).toMatchObject({ filename: "Plan.docx", size_bytes: 12 });
    const completeSess = calls.find((c) => c.path.endsWith("/upload-sessions/sess-f1/complete"))!;
    expect(JSON.parse(String(completeSess.init.body))).toEqual({ parts: [{ part_number: 1, etag: '"e1"' }, { part_number: 2, etag: '"e2"' }] });
    const commit = calls.find((c) => c.path.endsWith("/versions/commit"))!;
    expect(JSON.parse(String(commit.init.body))).toEqual({ upload_id: "up-sess-1", base_revision: "7", edit_lock_id: "lock-1" });
    expect(header(commit.init, "Idempotency-Key")).toBe(header(createSess.init, "Idempotency-Key")?.replace(/:upload$/, ":commit"));
  });

  it("keeps a save at or below the threshold on the single-request frame upload route", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () =>
        json({ upload_id: "up-direct", checksum_sha256: "x", size_bytes: 8, claim_expires_at: "2026-10-08T11:00:00Z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json(COMMITTED),
    });
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: AT_BYTES, etag: "7" }, { ...call(), chunkedUploadThresholdBytes: THRESHOLD });
    expect(result).toMatchObject({ ok: true, versionId: "v-4" });
    expect(calls.some((c) => c.path.includes("/upload-sessions"))).toBe(false);
    expect(calls.some((c) => c.path === "/api/v1/office-frame/documents/doc-1/uploads")).toBe(true);
  });

  it("answers {ok:false} when commit returns 409 after a frame upload session", async () => {
    const { fetch } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/upload-sessions": () => json(sessionBody("sess-f2", "fpart"), 201),
      "PUT /s3/fpart-1": partOk('"e1"'),
      "PUT /s3/fpart-2": partOk('"e2"'),
      "POST /api/v1/office-frame/documents/doc-1/upload-sessions/sess-f2/complete": () =>
        json({ upload_id: "up-sess-2", checksum_sha256: "abc", size_bytes: 12, claim_expires_at: "2026-10-08T11:00:00Z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () =>
        json({ error: { code: "document_version_conflict", message: "stale" } }, 409),
    });
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: OVER_BYTES, etag: "6" }, { ...call(), chunkedUploadThresholdBytes: THRESHOLD });
    expect(result).toMatchObject({ ok: false, error: { code: "conflict", status: 409, details: { apiCode: "document_version_conflict" } } });
  });

  it("routes a saveAs above the threshold through the workspace upload-session route and rebinds to the created document", async () => {
    configureRuntime({ apiUrl: API });
    setAccessToken("session-tok");
    const { fetch, calls } = fakeFetch({
      "POST /api/v1/workspaces/ws-1/documents/upload-sessions": () => json(sessionBody("sess-w1", "wpart"), 201),
      "PUT /s3/wpart-1": partOk('"we1"'),
      "PUT /s3/wpart-2": partOk('"we2"'),
      "POST /api/v1/upload-sessions/sess-w1/complete": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
      "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
    });
    vi.stubGlobal("fetch", fetch);
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).saveAs!({ name: "Copy", folderId: "folder-9", data: OVER_BYTES }, { ...call(), chunkedUploadThresholdBytes: THRESHOLD });
    expect(result.save).toEqual({
      ok: true, versionId: "v-c1",
      file: expect.objectContaining({ fileId: "doc-2", name: "Copy.docx", etag: "1", writable: true }),
    });
    expect(result.rebind).toEqual({ documentId: "doc-2", token: COPY_TOKEN });
    expect(calls.some((c) => c.path === "/api/v1/workspaces/ws-1/documents/files")).toBe(false);
    const createSess = calls.find((c) => c.path === "/api/v1/workspaces/ws-1/documents/upload-sessions")!;
    expect(header(createSess.init, "Authorization")).toBe("Bearer session-tok");
    expect(header(createSess.init, "Idempotency-Key")).toMatch(/^frame-saveas-.*:upload$/);
    expect(JSON.parse(String(createSess.init.body))).toMatchObject({ filename: "Copy.docx", size_bytes: 12, parent_id: "folder-9", title: "Copy" });
  });

  it("places a chunked saveAs copy beside its source parent, or in My Folder for a root document (UNI-1847 D6)", async () => {
    configureRuntime({ apiUrl: API });
    setAccessToken("session-tok");
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: "folder-src" } }),
      "POST /api/v1/workspaces/ws-1/documents/upload-sessions": () => json(sessionBody("sess-w2", "wpart"), 201),
      "PUT /s3/wpart-1": partOk('"we1"'),
      "PUT /s3/wpart-2": partOk('"we2"'),
      "POST /api/v1/upload-sessions/sess-w2/complete": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
      "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
    });
    vi.stubGlobal("fetch", fetch);
    const result = await createDocsFrameApi({ apiUrl: API, fetch }).saveAs!({ name: "Copy", data: OVER_BYTES }, { ...call(), chunkedUploadThresholdBytes: THRESHOLD });
    expect(result.rebind.documentId).toBe("doc-2");
    const createSess = calls.find((c) => c.path === "/api/v1/workspaces/ws-1/documents/upload-sessions")!;
    expect(JSON.parse(String(createSess.init.body))).toMatchObject({ filename: "Copy.docx", parent_id: "folder-src", title: "Copy" });
  });

  it("uses the single-request routes for both save and saveAs when threshold is null", async () => {
    configureRuntime({ apiUrl: API });
    setAccessToken("session-tok");
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "GET /api/v1/documents/doc-1": () => json({ document: { id: "doc-1", workspace_id: "ws-1", kind: "file", title: "Plan", revision: "7", parent_id: "folder-src" } }),
      "POST /api/v1/office-frame/documents/doc-1/uploads": () =>
        json({ upload_id: "up-1", checksum_sha256: "x", size_bytes: 12, claim_expires_at: "2026-10-08T11:00:00Z" }),
      "POST /api/v1/office-frame/documents/doc-1/versions/commit": () => json(COMMITTED),
      "POST /api/v1/workspaces/ws-1/documents/files": () => json({ document: COPY }),
      "POST /api/v1/documents/doc-2/office/frame-token": () => json(COPY_TOKEN),
      "GET /api/v1/office-frame/documents/doc-2": () => json(OPENED),
    });
    vi.stubGlobal("fetch", fetch);
    const api = createDocsFrameApi({ apiUrl: API, fetch });
    const saved = await api.save({ fileId: "doc-1", data: OVER_BYTES, etag: "7" }, { ...call(), chunkedUploadThresholdBytes: null });
    expect(saved).toMatchObject({ ok: true, versionId: "v-4" });
    const savedAs = await api.saveAs!({ name: "Copy", data: OVER_BYTES }, { ...call(), chunkedUploadThresholdBytes: null });
    expect(savedAs.rebind.documentId).toBe("doc-2");
    expect(calls.some((c) => c.path.includes("upload-sessions"))).toBe(false);
  });

  it("cancels the upload session (DELETE) when the call signal aborts during a chunked save", async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/upload-sessions": () => json(sessionBody("sess-abort", "fpart"), 201),
      "PUT /s3/fpart-1": () => { controller.abort(); return new Response(null, { status: 200, headers: { ETag: '"e1"' } }); },
      "PUT /s3/fpart-2": partOk('"e2"'),
      "DELETE /api/v1/office-frame/documents/doc-1/upload-sessions/sess-abort": () => new Response(null, { status: 204 }),
    });
    const saving = createDocsFrameApi({ apiUrl: API, fetch }).save({ fileId: "doc-1", data: OVER_BYTES, etag: "7" }, { ...call(), signal: controller.signal, chunkedUploadThresholdBytes: THRESHOLD });
    await expect(saving).rejects.toMatchObject({ code: "cancelled" });
    expect(calls.some((c) => c.method === "DELETE" && c.path.endsWith("/upload-sessions/sess-abort"))).toBe(true);
  });

  it("maps a 423 document_locked on frame upload-session create to the lock-refused protocol error without uploading parts (UNI-1890)", async () => {
    const fields = {
      holder_id: "u2",
      holder_name: "An",
      since: "2026-10-15T03:12:00Z",
      expires_at: "2026-10-15T03:14:00Z",
      held_by_me: false,
      current_revision: "8",
    };
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "POST /api/v1/office-frame/documents/doc-1/upload-sessions": () =>
        json({ error: { code: "document_locked", message: "đang sửa", fields } }, 423),
    });
    const saving = createDocsFrameApi({ apiUrl: API, fetch }).save(
      { fileId: "doc-1", data: OVER_BYTES, etag: "7" },
      { ...call(), editLockId: "lock-1", chunkedUploadThresholdBytes: THRESHOLD },
    );
    await expect(saving).rejects.toMatchObject({
      code: "forbidden",
      status: 423,
      message: "document_locked (HTTP 423)",
      details: { apiCode: "document_locked", fields },
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/v1/office-frame/documents/doc-1",
      "POST /api/v1/office-frame/documents/doc-1/upload-sessions",
    ]);
  });
});

describe("createDocsFrameApi saveCopy (UNI-1872)", () => {
  const COPY = {
    id: "doc-copy-1", organization_id: "org-1", workspace_id: "ws-1", parent_id: null, kind: "file", title: "Plan (copy)",
    visibility: "restricted", revision: "1", current_version: 1, position: 0, created_by: "u1", created_by_kind: "human",
    updated_by: "u1", updated_by_kind: "human", created_at: "2026-10-17T10:00:00Z", updated_at: "2026-10-17T10:00:00Z",
  };
  const UPLOAD = { upload_id: "up-copy-1", checksum_sha256: "abc", size_bytes: 4, claim_expires_at: "2026-10-17T11:00:00Z" };

  function setup(routes: Record<string, Route>) {
    configureRuntime({ apiUrl: API });
    setAccessToken("session-tok");
    const fake = fakeFetch(routes);
    vi.stubGlobal("fetch", fake.fetch);
    return { ...fake, api: createDocsFrameApi({ apiUrl: API, fetch: fake.fetch }) };
  }

  it("stages the frame's bytes on the source document and creates the copy via /documents/{id}/copies without rebinding", async () => {
    const { api, calls } = setup({
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json(UPLOAD),
      "POST /api/v1/documents/doc-1/copies": () => json({ document: COPY }),
    });
    const result = await api.saveCopy!({ name: "Plan (copy)", data: new Uint8Array([1, 2, 3, 4]).buffer }, call());
    expect(result).toEqual({ documentId: "doc-copy-1", title: "Plan (copy)" });
    expect(calls).toHaveLength(2);
    const [uploadCall, copyCall] = calls;
    const uploadForm = uploadCall!.init.body as FormData;
    expect((uploadForm.get("file") as File).name).toBe("Plan (copy).docx");
    expect(header(uploadCall!.init, "Authorization")).toBe("Bearer frame-tok");
    const uploadKey = header(uploadCall!.init, "Idempotency-Key");
    const copyKey = new Headers(copyCall!.init.headers).get("Idempotency-Key");
    expect(copyKey).toMatch(/^frame-savecopy-/);
    expect(uploadKey).toBe(`${copyKey}:upload`);
    expect(new Headers(copyCall!.init.headers).get("Authorization")).toBe("Bearer session-tok");
    expect(JSON.parse(String(copyCall!.init.body))).toEqual({
      consent: "copy",
      upload_id: "up-copy-1",
      title: "Plan (copy)",
    });
  });

  it("keys one saveCopy by source document, name and bytes, so a retry replays the same upload and copy", async () => {
    const keyOf = async (bytes: number[], name = "Plan (copy)", documentId = "doc-1") => {
      const { api, calls } = setup({
        [`POST /api/v1/office-frame/documents/${documentId}/uploads`]: () => json(UPLOAD),
        [`POST /api/v1/documents/${documentId}/copies`]: () => json({ document: COPY }),
      });
      await api.saveCopy!({ name, data: new Uint8Array(bytes).buffer }, { ...call(), documentId });
      return new Headers(calls[1]!.init.headers).get("Idempotency-Key");
    };
    expect(await keyOf([1, 2])).toBe(await keyOf([1, 2]));
    expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 3]));
    expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 2], "Other (copy)"));
    expect(await keyOf([1, 2])).not.toBe(await keyOf([1, 2], "Plan (copy)", "doc-9"));
  });

  it("degrades a malformed upload or copy answer to a typed internal error", async () => {
    const badUpload = setup({ "POST /api/v1/office-frame/documents/doc-1/uploads": () => json({ upload_id: "" }) });
    await expect(badUpload.api.saveCopy!({ name: "Plan (copy).docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "internal" });

    const badCopy = setup({
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json(UPLOAD),
      "POST /api/v1/documents/doc-1/copies": () => json({ document: { id: 7 } }),
    });
    await expect(badCopy.api.saveCopy!({ name: "Plan (copy).docx", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code: "internal" });
  });

  it("maps 403, 404, 409 and 413 (preserving max_bytes on upload or copy) to protocol error codes", async () => {
    const uploadTooLarge = setup({
      "POST /api/v1/office-frame/documents/doc-1/uploads": () =>
        json({ error: { code: "file_too_large", message: "big", fields: { max_bytes: 52_428_800 } } }, 413),
    });
    await expect(uploadTooLarge.api.saveCopy!({ name: "Big", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({
      code: "too_large",
      status: 413,
      details: { apiCode: "file_too_large", max_bytes: 52_428_800 },
    });

    const copyTooLarge = setup({
      "POST /api/v1/office-frame/documents/doc-1/uploads": () => json(UPLOAD),
      "POST /api/v1/documents/doc-1/copies": () =>
        json({ error: { code: "file_too_large", message: "big", fields: { max_bytes: 10_485_760 } } }, 413),
    });
    await expect(copyTooLarge.api.saveCopy!({ name: "Big", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({
      code: "too_large",
      status: 413,
      details: { apiCode: "file_too_large", max_bytes: 10_485_760 },
    });

    for (const [status, apiCode, code] of [
      [403, "forbidden", "forbidden"],
      [404, "not_found", "not_found"],
      [409, "conflict", "conflict"],
    ] as const) {
      const { api } = setup({
        "POST /api/v1/office-frame/documents/doc-1/uploads": () => json(UPLOAD),
        "POST /api/v1/documents/doc-1/copies": () => json({ error: { code: apiCode, message: apiCode } }, status),
      });
      await expect(api.saveCopy!({ name: "Copy", data: new ArrayBuffer(1) }, call())).rejects.toMatchObject({ code, status });
    }
  });
});

describe("createOfficeFrameSourceApi (UNI-1869)", () => {
  const SRC_ID = "chat:01J8X4MSG0N1P2Q3R4S5T6U7V8";
  const SRC = {
    source_id: SRC_ID, principal: "source", workspace_id: "ws-1", organization_id: "org-1",
    title: "Báo cáo.docx", revision: "0", module: "docs", can_edit: false, readonly: true,
    parent: { kind: "chat_channel", id: "c-1", title: "Kênh chung" },
    file: { version: 1, filename: "Báo cáo.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 48213 },
    download_url: `/api/v1/office-frame/sources/${encodeURIComponent(SRC_ID)}/content`,
    updated_at: "2026-10-17T08:00:00Z",
  };
  const sourceCall = (): DocsFrameCall => ({ workspaceId: "ws-1", documentId: SRC_ID, token: "ofs1.tok", signal: new AbortController().signal });

  it("opens the source under its own base and hands the frame read-only meta and bytes", async () => {
    const { fetch, calls } = fakeFetch({
      [`GET /api/v1/office-frame/sources/${encodeURIComponent(SRC_ID)}`]: () => json(SRC),
      [`GET ${SRC.download_url}`]: () => new Response(new Uint8Array([9, 8, 7])),
    });
    const api = createOfficeFrameSourceApi("docs", { apiUrl: API, fetch });
    const opened = await api.open({ fileId: SRC_ID }, sourceCall());
    expect(opened.file).toEqual({
      fileId: SRC_ID, name: "Báo cáo.docx", sizeBytes: 48213,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      etag: "0", writable: false, modifiedAt: Date.parse("2026-10-17T08:00:00Z"),
    });
    expect(opened.assets).toBeUndefined();
    expect(opened.source.kind === "bytes" && new Uint8Array(opened.source.data)).toEqual(new Uint8Array([9, 8, 7]));
    for (const { init } of calls) {
      expect(header(init, "Authorization")).toBe("Bearer ofs1.tok");
      expect(init.credentials).toBe("omit");
    }
  });

  it("refuses a source the token is not scoped to without calling the API", async () => {
    const { fetch } = fakeFetch({});
    await expect(createOfficeFrameSourceApi("docs", { apiUrl: API, fetch }).open({ fileId: "chat:other" }, sourceCall())).rejects.toMatchObject({ code: "forbidden" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("has nothing but open: no save, recents, export, assets or image routes exist for a source", async () => {
    const api = createOfficeFrameSourceApi("markdown", { apiUrl: API, fetch: fakeFetch({}).fetch });
    await expect(api.save({ fileId: SRC_ID, data: new ArrayBuffer(1), etag: "0" }, sourceCall())).rejects.toMatchObject({ code: "unsupported" });
    for (const key of ["saveAs", "export", "addAttachments", "uploadImage", "resolveAssets", "recents"] as const) {
      expect(api[key]).toBeUndefined();
    }
  });

  it("degrades a malformed open answer to a typed error", async () => {
    const { fetch } = fakeFetch({ [`GET /api/v1/office-frame/sources/${encodeURIComponent(SRC_ID)}`]: () => json({ source_id: 42 }) });
    await expect(createOfficeFrameSourceApi("docs", { apiUrl: API, fetch }).open({ fileId: SRC_ID }, sourceCall())).rejects.toMatchObject({ code: "internal" });
  });
});
