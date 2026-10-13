import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import { listDocumentChanges } from "./document-changes";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const errorBody = (code: string, status: number) =>
  json({ error: { code, message: code } }, status);

const rowBody = (over: Record<string, unknown> = {}) => ({
  document_id: "d1",
  kind: "file",
  revision: "41",
  current_version: 3,
  version_id: "v1",
  ...over,
});

const pageBody = (over: Record<string, unknown> = {}) => ({
  phase: "snapshot",
  changes: [rowBody(), rowBody({ document_id: "d2", kind: "page", revision: "9007199254740993", version_id: null })],
  has_more: true,
  next_cursor: "dcc1.abc.sig",
  expires_at: "2026-10-13T10:15:00Z",
  ...over,
});

describe("listDocumentChanges", () => {
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

  it("opens a snapshot without a cursor and returns the typed page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(pageBody()));
    const out = await listDocumentChanges("w1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/workspaces/w1/documents/changes");
    expect(init?.method).toBe("GET");
    expect(out.kind).toBe("page");
    if (out.kind !== "page") return;
    expect(out.page.phase).toBe("snapshot");
    expect(out.page.hasMore).toBe(true);
    expect(out.page.nextCursor).toBe("dcc1.abc.sig");
    expect(out.page.expiresAt).toBe("2026-10-13T10:15:00Z");
    expect(out.page.changes).toEqual([
      { documentId: "d1", kind: "file", revision: "41", currentVersion: 3, versionId: "v1" },
      // The revision stays a decimal string: 2^53 + 1 would not survive a number.
      { documentId: "d2", kind: "page", revision: "9007199254740993", currentVersion: 3, versionId: null },
    ]);
  });

  it("sends the cursor and limit as query parameters, encoded", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(pageBody({ has_more: false })));
    await listDocumentChanges("w 1", { cursor: "dcc1.a/b+c.sig", limit: 50 });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(
      "http://api.test/api/v1/workspaces/w%201/documents/changes?cursor=dcc1.a%2Fb%2Bc.sig&limit=50",
    );
  });

  it("keeps an unknown phase and kind (lenient enums)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(pageBody({ phase: "feed", changes: [rowBody({ kind: "sheet-from-the-future" })] })),
    );
    const out = await listDocumentChanges("w1", { cursor: "c" });
    expect(out.kind).toBe("page");
    if (out.kind !== "page") return;
    expect(out.page.phase).toBe("feed");
    expect(out.page.changes[0]?.kind).toBe("sheet-from-the-future");
  });

  it("treats a missing version_id as null", async () => {
    const { version_id: _drop, ...row } = rowBody();
    vi.mocked(fetch).mockResolvedValueOnce(json(pageBody({ changes: [row] })));
    const out = await listDocumentChanges("w1");
    expect(out.kind === "page" && out.page.changes[0]?.versionId).toBeNull();
  });

  const malformed: Array<[string, unknown]> = [
    ["an empty object", {}],
    ["null", null],
    ["an array", []],
    ["a string", "str"],
    ["changes that is not a list", pageBody({ changes: "x" })],
    ["a numeric revision", pageBody({ changes: [rowBody({ revision: 41 })] })],
    ["a non-decimal revision", pageBody({ changes: [rowBody({ revision: "v41" })] })],
    ["a row without a document id", pageBody({ changes: [rowBody({ document_id: "" })] })],
    ["a missing next_cursor", pageBody({ next_cursor: undefined })],
    ["an empty next_cursor", pageBody({ next_cursor: "" })],
    ["a non-boolean has_more", pageBody({ has_more: "yes" })],
    ["a row without current_version", pageBody({ changes: [rowBody({ current_version: undefined })] })],
    ["a non-integer current_version", pageBody({ changes: [rowBody({ current_version: 1.5 })] })],
    ["a numeric version_id", pageBody({ changes: [rowBody({ version_id: 7 })] })],
    ["a missing phase", pageBody({ phase: undefined })],
    ["a missing expires_at", pageBody({ expires_at: undefined })],
  ];

  it.each(malformed)("degrades to an unavailable result on %s, never a throw, never a short page", async (_name, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    const out = await listDocumentChanges("w1");
    expect(out).toEqual({ kind: "unavailable", reason: "malformed_response" });
  });

  it("maps 410 change_cursor_expired to a resync result", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorBody("change_cursor_expired", 410));
    const out = await listDocumentChanges("w1", { cursor: "old" });
    expect(out).toEqual({ kind: "resync", reason: "cursor_expired" });
  });

  it("maps 400 change_cursor_invalid to a resync result too: the only recovery is a cold start", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorBody("change_cursor_invalid", 400));
    const out = await listDocumentChanges("w1", { cursor: "forged" });
    expect(out).toEqual({ kind: "resync", reason: "cursor_invalid" });
  });

  it("does not turn a 400 invalid_request (bad limit) into a resync", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorBody("invalid_request", 400));
    await expect(listDocumentChanges("w1", { limit: -1 })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  });

  it.each([
    ["constructor", 410],
    ["constructor", 400],
    ["toString", 400],
    ["__proto__", 410],
    ["__proto__", 400],
  ])("does not read %s (%i) off Object.prototype as a resync", async (code, status) => {
    vi.mocked(fetch).mockResolvedValueOnce(errorBody(code, status));
    const err = await listDocumentChanges("w1", { cursor: "c" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code, status });
  });

  it("does not turn another 410 code into a resync", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorBody("commit_intent_unknown", 410));
    await expect(listDocumentChanges("w1", { cursor: "c" })).rejects.toMatchObject({ code: "commit_intent_unknown", status: 410 });
  });

  it.each([
    ["office_capability_off", 403],
    ["forbidden", 403],
    ["not_found", 404],
    ["unsupported_operation", 501],
  ])("lets %s (%i) reject as an ApiError like the neighbouring endpoints", async (code, status) => {
    vi.mocked(fetch).mockResolvedValueOnce(errorBody(code, status));
    const err = await listDocumentChanges("w1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code, status });
  });
});
