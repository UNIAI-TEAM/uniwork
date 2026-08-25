import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./http";
import { setAccessToken } from "./session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("request", () => {
  beforeEach(() => {
    setAccessToken("tok-1");
    vi.stubGlobal("fetch", vi.fn());
    // The base URL arrives through the platform injection point rather than
    // the environment, so the test configures it the same way the app does.
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("attaches the bearer token and returns the raw JSON body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ value: 7 }));
    const out = await request("/api/v1/x");
    // Untyped on purpose: shaping is the endpoint's job, through a schema.
    expect(out).toEqual({ value: 7 });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/x");
    expect((init!.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
  });

  it("refreshes once on 401 then retries", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okJson({ error: { code: "unauthorized", message: "x" } }, 401))
      .mockResolvedValueOnce(
        okJson({ user: { id: "u", email: "a@b.c", display_name: "A" }, access_token: "tok-2" }),
      )
      .mockResolvedValueOnce(okJson({ ok: true }));
    const out = (await request("/api/v1/x")) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe("http://api.test/api/v1/auth/refresh");
    // The retry carries the rotated token.
    const retryInit = vi.mocked(fetch).mock.calls[2]![1]!;
    expect((retryInit.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-2");
  });

  it("throws ApiError with the code from the body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ error: { code: "not_found", message: "m" } }, 404));
    await expect(request("/api/v1/x")).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(() => new ApiError("x", "c", 1)).not.toThrow();
  });

  it("returns undefined for an empty 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(request("/api/v1/x", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
