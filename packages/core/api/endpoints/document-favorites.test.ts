import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  favoriteDocument,
  listDocumentFavorites,
  unfavoriteDocument,
} from "./document-favorites";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const favoriteBody = (over: Record<string, unknown> = {}) => ({
  document_id: "d1",
  favorite_id: "f1",
  workspace_id: "w1",
  title: "Kế hoạch Q4",
  kind: "page",
  favorited_at: "2026-09-28T08:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { favorite: "x" }, null, [], "str"];

describe("document favorite endpoints", () => {
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

  it("listDocumentFavorites reads the organization route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ favorites: [favoriteBody()] }));
    const out = await listDocumentFavorites("o1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/documents/favorites");
    expect(init?.method).toBe("GET");
    expect(out).toHaveLength(1);
    expect(out[0]?.document_id).toBe("d1");
    expect(out[0]?.kind).toBe("page");
  });

  it("favoriteDocument POSTs the document route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ favorite: favoriteBody() }));
    const out = await favoriteDocument("d1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/favorite");
    expect(init?.method).toBe("POST");
    expect(out?.favorite_id).toBe("f1");
  });

  it("unfavoriteDocument DELETEs the document route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await unfavoriteDocument("d1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/favorite");
    expect(init?.method).toBe("DELETE");
  });

  it("degrades a malformed favorites list to []", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(listDocumentFavorites("o1")).resolves.toEqual([]);
    }
  });

  it("returns null for a malformed favorite and never throws on unfavorite", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(favoriteDocument("d1")).resolves.toBeNull();
    }
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    await expect(unfavoriteDocument("d1")).resolves.toBeUndefined();
  });
});
