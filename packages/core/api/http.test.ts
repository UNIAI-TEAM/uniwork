import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiErrorMessage, errorClassOf, request } from "./http";
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

  it("attaches ErrorSDO fields when the server sends them", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson(
        {
          error: {
            code: "active_duplicate_task",
            message: "trùng",
            fields: { task_id: "t1", identifier: "UNI-1", title: "Bug" },
          },
        },
        409,
      ),
    );
    await expect(request("/api/v1/x")).rejects.toMatchObject({
      code: "active_duplicate_task",
      status: 409,
      fields: { task_id: "t1", identifier: "UNI-1", title: "Bug" },
    });
  });

  it("parses error.error_class into ApiError.errorClass", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({ error: { code: "revision_conflict", message: "stale", error_class: "conflict" } }, 422),
    );
    const err = await request("/api/v1/x").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "revision_conflict", status: 422, errorClass: "conflict" });
    expect(errorClassOf(err)).toBe("conflict");
    expect(errorClassOf(new Error("x"))).toBeUndefined();
  });

  it("degrades unknown and malformed error_class to undefined without throwing", async () => {
    for (const errorClass of [42, { kind: "conflict" }, ["conflict"], "future_class", null]) {
      vi.mocked(fetch).mockResolvedValueOnce(
        okJson({ error: { code: "c", message: "m", error_class: errorClass } }, 400),
      );
      await expect(request("/api/v1/x")).rejects.toMatchObject({ code: "c", errorClass: undefined });
    }
  });

  it("degrades non-object error fields and non-object bodies without throwing", async () => {
    for (const body of [
      { error: "plain string" },
      { error: null },
      { error: [1, 2] },
      "not an object",
      42,
      null,
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(okJson(body, 500));
      const err = await request("/api/v1/x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).errorClass).toBeUndefined();
    }
  });

  it("reads Retry-After as seconds, as an HTTP date, and ignores junk", async () => {
    const withRetryAfter = (value: string) =>
      new Response(JSON.stringify({ error: { code: "rate_limited", message: "m" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": value },
      });
    vi.mocked(fetch).mockResolvedValueOnce(withRetryAfter("60"));
    await expect(request("/api/v1/x")).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });

    const inAMinute = new Date(Date.now() + 60_000).toUTCString();
    vi.mocked(fetch).mockResolvedValueOnce(withRetryAfter(inAMinute));
    const dated = (await request("/api/v1/x").catch((e: unknown) => e)) as ApiError;
    expect(dated.retryAfterSeconds).toBeGreaterThanOrEqual(58);
    expect(dated.retryAfterSeconds).toBeLessThanOrEqual(60);

    vi.mocked(fetch).mockResolvedValueOnce(withRetryAfter("soon"));
    await expect(request("/api/v1/x")).rejects.toMatchObject({ retryAfterSeconds: undefined });
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ error: { code: "c", message: "m" } }, 503));
    await expect(request("/api/v1/x")).rejects.toMatchObject({ retryAfterSeconds: undefined });
  });

  it("leaves errorClass undefined when the server omits it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ error: { code: "not_found", message: "m" } }, 404));
    await expect(request("/api/v1/x")).rejects.toMatchObject({ code: "not_found", errorClass: undefined });
  });

  it("extracts the server message from ApiError", () => {
    expect(apiErrorMessage(new ApiError("thao tác không hợp lệ", "invalid_meeting_state", 409))).toBe(
      "thao tác không hợp lệ",
    );
    expect(apiErrorMessage(new Error("network down"))).toBe("network down");
    expect(apiErrorMessage("nope")).toBeUndefined();
  });

  it("hands the caller's abort signal to fetch, so a cancelled query stops its request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okJson({ ok: true }));
    const controller = new AbortController();
    await request("/api/v1/x", { signal: controller.signal });
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal).toBe(controller.signal);
  });

  it("returns undefined for an empty 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(request("/api/v1/x", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
