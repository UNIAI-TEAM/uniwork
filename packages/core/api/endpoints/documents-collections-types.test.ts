import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  listDocuments,
  listFavoriteDocuments,
  listRecentDocuments,
  listSharedByMe,
  listSharedWithMe,
  listShelvedDocuments,
  listTrashedDocuments,
} from "./documents-collections";

// UNI-2113 contract A: the Type select sends the REPEATED `type` query param
// (`?type=docx&type=xlsx`) on every document list route. The response is
// unchanged, so no schema or malformed-response case is added here; the
// existing ones in documents-collections*.test.ts cover the same functions.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const emptyList = () => ({ documents: [], next_cursor: null });

const url = (call: number) => new URL(String(vi.mocked(fetch).mock.calls[call]![0]));

describe("documents-collections repeated type param (UNI-2113)", () => {
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

  it("sends one type= per value, in order, on every list route", async () => {
    const calls = [
      () => listDocuments("w1", { parentId: "", types: ["docx", "xlsx"] }),
      () => listRecentDocuments("w1", { types: ["docx", "xlsx"] }),
      () => listFavoriteDocuments("w1", { types: ["docx", "xlsx"] }),
      () => listSharedWithMe("w1", { types: ["docx", "xlsx"] }),
      () => listSharedByMe("w1", { types: ["docx", "xlsx"] }),
      () => listShelvedDocuments("w1", { types: ["docx", "xlsx"] }),
      () => listTrashedDocuments("w1", { types: ["docx", "xlsx"] }),
    ];
    for (const [index, call] of calls.entries()) {
      vi.mocked(fetch).mockResolvedValueOnce(json(emptyList()));
      await call();
      expect(url(index).searchParams.getAll("type")).toEqual(["docx", "xlsx"]);
      expect(url(index).search).toContain("type=docx&type=xlsx");
    }
  });

  it("carries page next to a format and keeps format= and kind= as they were", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(emptyList()));
    await listDocuments("w1", { types: ["page", "pdf"], kind: "document", format: "pdf", limit: 5 });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents?kind=document&format=pdf&type=page&type=pdf&limit=5",
    );
  });

  it("sends no type= for none, an empty list or an absent value", async () => {
    for (const opts of [{}, { types: [] }, { types: undefined }]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(emptyList()));
      await listDocuments("w1", opts);
    }
    vi.mocked(fetch).mockResolvedValueOnce(json(emptyList()));
    await listFavoriteDocuments("w1", { limit: 5 });
    for (let call = 0; call < 3; call += 1) expect(url(call).searchParams.has("type")).toBe(false);
    expect(String(vi.mocked(fetch).mock.calls[3]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/favorites?limit=5",
    );
  });

  it("percent-encodes a value instead of splitting the query", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(emptyList()));
    await listDocuments("w1", { types: ["a&b=c"] });
    expect(url(0).searchParams.getAll("type")).toEqual(["a&b=c"]);
  });
});
