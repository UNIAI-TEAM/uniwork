import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import type { DocumentVersion } from "../types/document";
import { createVersionFrameApi } from "./docs-frame-version-api";
import type { DocsFrameCall } from "./docs-frame-api";

vi.mock("../api/endpoints/documents-versions", () => ({ getDocumentVersion: vi.fn() }));
import { getDocumentVersion } from "../api/endpoints/documents-versions";

const API = "http://api.test";
const DOC = {
  document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", title: "Plan", revision: "7", can_edit: true,
  file: { file_id: "f-3", version_id: "v-3", version: 3, filename: "Plan.docx", mime_type: "application/docx", size_bytes: 9, checksum_sha256: "abc" },
  download_url: "/api/v1/office-frame/documents/doc-1/content?version=3",
  updated_at: "2026-10-08T10:00:00Z",
};
const V2: DocumentVersion = { id: "v-2", document_id: "doc-1", version: 2, kind: "file", reason: "manual", size_bytes: 4, mime_type: "application/docx", created_by: "u", created_by_kind: "human", created_at: "" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${String(input).slice(API.length)}`;
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return route();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const call = (): DocsFrameCall => ({ workspaceId: "ws-1", documentId: "doc-1", token: "frame-tok", signal: new AbortController().signal });

afterEach(() => { vi.mocked(getDocumentVersion).mockReset(); });

describe("createVersionFrameApi (UNI-2033)", () => {
  it("opens version N: name from the document, bytes from content?version=N, versionId from the version row", async () => {
    vi.mocked(getDocumentVersion).mockResolvedValue(V2);
    const { fetch, calls } = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "GET /api/v1/office-frame/documents/doc-1/content?version=2": () => new Response(new Uint8Array([1, 2, 3, 4])),
    });
    const opened = await createVersionFrameApi("docs", 2, { apiUrl: API, fetch }).open({ fileId: "doc-1" }, call());
    expect(calls).toEqual(["GET /api/v1/office-frame/documents/doc-1", "GET /api/v1/office-frame/documents/doc-1/content?version=2"]);
    expect(getDocumentVersion).toHaveBeenCalledWith("doc-1", 2, expect.anything());
    expect(opened.file).toMatchObject({ fileId: "doc-1", name: "Plan.docx", versionId: "v-2", sizeBytes: 4, writable: false });
    expect(opened.source).toEqual({ kind: "bytes", data: new Uint8Array([1, 2, 3, 4]).buffer });
  });

  it("answers not_found for a version the document does not have", async () => {
    vi.mocked(getDocumentVersion).mockRejectedValue(new ApiError("no", "not_found", 404));
    const { fetch } = fakeFetch({ "GET /api/v1/office-frame/documents/doc-1": () => json(DOC) });
    await expect(createVersionFrameApi("docs", 9, { apiUrl: API, fetch }).open({ fileId: "doc-1" }, call())).rejects.toMatchObject({ code: "not_found" });
  });

  it("answers not_found when the version row reads back empty, and when the bytes are gone", async () => {
    vi.mocked(getDocumentVersion).mockResolvedValue(null);
    const { fetch } = fakeFetch({ "GET /api/v1/office-frame/documents/doc-1": () => json(DOC) });
    await expect(createVersionFrameApi("docs", 9, { apiUrl: API, fetch }).open({ fileId: "doc-1" }, call())).rejects.toMatchObject({ code: "not_found" });
    vi.mocked(getDocumentVersion).mockResolvedValue(V2);
    const gone = fakeFetch({
      "GET /api/v1/office-frame/documents/doc-1": () => json(DOC),
      "GET /api/v1/office-frame/documents/doc-1/content?version=2": () => json({ error: { code: "not_found", message: "x" } }, 404),
    });
    await expect(createVersionFrameApi("docs", 2, { apiUrl: API, fetch: gone.fetch }).open({ fileId: "doc-1" }, call())).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a file the token is not scoped to, and never saves", async () => {
    const api = createVersionFrameApi("docs", 2, { apiUrl: API, fetch: fakeFetch({}).fetch });
    await expect(api.open({ fileId: "other" }, call())).rejects.toMatchObject({ code: "forbidden" });
    await expect(api.save({ fileId: "doc-1", data: new ArrayBuffer(1), etag: "7" } as never, call())).rejects.toMatchObject({ code: "unsupported" });
    expect(api.saveAs).toBeUndefined();
    expect(api.recents).toBeUndefined();
    expect(api.export).toBeUndefined();
  });
});
