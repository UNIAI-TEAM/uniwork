import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  aiCloudAnalyzeMedia,
  aiCloudGenerateImage,
  aiCloudSearch,
  aiCloudTranscribe,
  byokProxyBaseUrl,
  deleteAiCredential,
  getAiCloudStatus,
  listAiCredentials,
  saveAiCredential,
} from "./ai-office";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const callUrl = (i: number) => vi.mocked(fetch).mock.calls[i]![0];
const callInit = (i: number) => vi.mocked(fetch).mock.calls[i]![1] as RequestInit;

describe("ai-office endpoints", () => {
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

  it("byokProxyBaseUrl points a vendor protocol at the org route", () => {
    expect(byokProxyBaseUrl("o1", "openai")).toBe("http://api.test/api/v1/orgs/o1/ai/byok/openai");
    expect(byokProxyBaseUrl("o1", "a/b")).toBe("http://api.test/api/v1/orgs/o1/ai/byok/a%2Fb");
  });

  it("listAiCredentials keeps providers, defaults missing fields and degrades to empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [{ provider: "openai", key_hint: "…abcd" }],
        providers: [{ id: "custom", protocol: "openai-compatible", requires_base_url: true }],
      }),
    );
    const res = await listAiCredentials("o1");
    expect(callUrl(0)).toBe("http://api.test/api/v1/orgs/o1/ai/credentials");
    expect(res.items[0]).toMatchObject({ provider: "openai", label: "", base_url: "", key_hint: "…abcd" });
    expect(res.providers[0]!.requires_base_url).toBe(true);
    expect(res.providers[0]!.default_base_url).toBe("");
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope", providers: [{ id: 1 }] }));
    expect(await listAiCredentials("o1")).toEqual({ items: [], providers: [] });
  });

  it("saveAiCredential PUTs the body, parses the credential and degrades on a malformed answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ provider: "openai", label: "work", key_hint: "…wxyz", created_at: "t", updated_at: "t" }, 201),
    );
    const cred = await saveAiCredential("o1", "openai", { api_key: "sk-secret", label: "work" });
    expect(cred.key_hint).toBe("…wxyz");
    expect(callUrl(0)).toBe("http://api.test/api/v1/orgs/o1/ai/credentials/openai");
    expect(callInit(0).method).toBe("PUT");
    expect(JSON.parse(callInit(0).body as string)).toEqual({ api_key: "sk-secret", label: "work" });
    // A malformed 2xx does not throw: it falls back to what the request said, never the key.
    vi.mocked(fetch).mockResolvedValueOnce(json({ provider: 7 }));
    const degraded = await saveAiCredential("o1", "openai", {
      api_key: "sk-secret",
      label: "work",
      base_url: "https://x.test/v1",
    });
    expect(degraded).toEqual({
      provider: "openai",
      label: "work",
      base_url: "https://x.test/v1",
      key_hint: "…",
      created_at: "",
      updated_at: "",
    });
    expect(JSON.stringify(degraded)).not.toContain("sk-secret");
  });

  it("deleteAiCredential sends DELETE and tolerates an empty 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteAiCredential("o1", "openai");
    expect(callUrl(0)).toBe("http://api.test/api/v1/orgs/o1/ai/credentials/openai");
    expect(callInit(0).method).toBe("DELETE");
  });

  it("getAiCloudStatus fills the credits line and degrades to disabled", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        enabled: true,
        tools: { web_search: true, image_generate: true },
        credits: { unit: "ai.tokens", used: 10, limit: 100, remaining: 90, period_end: "2026-11-01T00:00:00Z" },
      }),
    );
    const ok = await getAiCloudStatus("o1");
    expect(callUrl(0)).toBe("http://api.test/api/v1/orgs/o1/ai/cloud");
    expect(ok.tools.web_search).toBe(true);
    expect(ok.tools.transcribe).toBe(false);
    expect(ok.credits.remaining).toBe(90);
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: false, reason: "entitlement_required" }));
    const off = await getAiCloudStatus("o1");
    expect(off.reason).toBe("entitlement_required");
    expect(off.credits.limit).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: "yes", tools: 3 }));
    expect((await getAiCloudStatus("o1")).enabled).toBe(false);
  });

  it("aiCloudSearch posts the query and degrades to no results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ results: [{ title: "T", url: "https://x", snippet: "s", image_url: "https://i" }], answer: "A" }),
    );
    const res = await aiCloudSearch("o1", { query: "uniwork", kind: "image", max_results: 3 });
    expect(callUrl(0)).toBe("http://api.test/api/v1/orgs/o1/ai/cloud/search");
    expect(callInit(0).method).toBe("POST");
    expect(JSON.parse(callInit(0).body as string)).toEqual({ query: "uniwork", kind: "image", max_results: 3 });
    expect(res.results[0]!.image_url).toBe("https://i");
    expect(res.answer).toBe("A");
    vi.mocked(fetch).mockResolvedValueOnce(json({ results: "many" }));
    expect(await aiCloudSearch("o1", { query: "q", kind: "web" })).toEqual({ results: [] });
  });

  it("aiCloudGenerateImage returns bytes and degrades to no images", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ images: [{ mime: "image/png", data_base64: "AAAA" }], model: "m" }));
    const res = await aiCloudGenerateImage("o1", { prompt: "a cat" });
    expect(callUrl(0)).toBe("http://api.test/api/v1/orgs/o1/ai/cloud/images");
    expect(res.images[0]).toEqual({ mime: "image/png", data_base64: "AAAA" });
    expect(res.model).toBe("m");
    vi.mocked(fetch).mockResolvedValueOnce(json({ images: [{ mime: 1 }] }));
    expect(await aiCloudGenerateImage("o1", { prompt: "p" })).toEqual({ images: [], model: "" });
  });

  it("aiCloudAnalyzeMedia and aiCloudTranscribe return text and degrade to empty text", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ text: "a chart" }));
    const media = [{ mime: "image/png", data_base64: "AAAA" }];
    expect((await aiCloudAnalyzeMedia("o1", { requirements: "describe", media })).text).toBe("a chart");
    expect(callUrl(0)).toBe("http://api.test/api/v1/orgs/o1/ai/cloud/media/analyze");
    vi.mocked(fetch).mockResolvedValueOnce(json({ text: 5 }));
    expect(await aiCloudAnalyzeMedia("o1", { requirements: "r", media })).toEqual({ text: "" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ text: "xin chào" }));
    const audio = { mime: "audio/mpeg", data_base64: "BBBB" };
    expect((await aiCloudTranscribe("o1", { audio })).text).toBe("xin chào");
    expect(callUrl(2)).toBe("http://api.test/api/v1/orgs/o1/ai/cloud/transcribe");
    vi.mocked(fetch).mockResolvedValueOnce(json([]));
    expect(await aiCloudTranscribe("o1", { prompt: "vi", audio })).toEqual({ text: "" });
  });
});
