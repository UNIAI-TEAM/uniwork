import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getPublicConfig, postWebVital } from "./config";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("config endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("getPublicConfig returns flags and the sample rate, scoped to an organization", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: { rum_sampling: true }, rum_sample_rate: 0.2 }));
    const cfg = await getPublicConfig("org1");
    expect(cfg).toEqual({ flags: { rum_sampling: true }, rum_sample_rate: 0.2 });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/api/v1/config?organization_id=org1");
  });

  it("getPublicConfig degrades a malformed response to no flags and no sampling", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: "nope", rum_sample_rate: 7 }));
    expect(await getPublicConfig()).toEqual({ flags: {}, rum_sample_rate: 0 });
    vi.mocked(fetch).mockResolvedValueOnce(json([1, 2]));
    expect(await getPublicConfig()).toEqual({ flags: {}, rum_sample_rate: 0 });
  });

  it("postWebVital sends the sample and resolves on 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(postWebVital("lcp", 1830, "/[orgSlug]/[workspaceSlug]/tasks")).resolves.toBeUndefined();
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ metric: "lcp", value: 1830, route: "/[orgSlug]/[workspaceSlug]/tasks" });
  });
});
