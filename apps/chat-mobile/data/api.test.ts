import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the session is the composition root's business; here it is three functions
const sessionMock = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => "at_1"),
  refresh: vi.fn<() => Promise<string | null>>(async () => "at_2"),
}));
vi.mock("./auth/flow", () => ({ session: sessionMock }));

import { ApiError, api, createApiClient } from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();
type Call = { url: string; init: RequestInit };
const calls = (): Call[] => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));
const header = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

beforeEach(() => {
  configureRuntime({ apiUrl: "https://uniwork.example" });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  sessionMock.getAccessToken.mockReset().mockResolvedValue("at_1");
  sessionMock.refresh.mockReset().mockResolvedValue("at_2");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetRuntimeConfig();
});

describe("api client", () => {
  it("sends JSON with the bearer from the session, a request id and the client platform, and parses /me", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: { id: "u1", email: "a@b.c", display_name: "A" } }));
    expect(await api.getMe()).toMatchObject({ id: "u1", email: "a@b.c", display_name: "A" });
    const { url, init } = calls()[0] as Call;
    expect(url).toBe("https://uniwork.example/api/v1/me");
    expect(init.method).toBe("GET");
    expect(header(init, "Authorization")).toBe("Bearer at_1");
    expect(header(init, "X-Request-ID")).toMatch(/^[a-z0-9-]{8,}$/);
    expect(header(init, "X-Client-Platform")).toBe("mobile");
    expect(header(init, "Content-Type")).toBe("application/json");
  });

  it("omits the bearer when signed out and degrades a drifted body to the fallback", async () => {
    sessionMock.getAccessToken.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(json(200, { user: { id: 7 } }));
    expect(await api.getMe()).toBeNull();
    expect(header(calls()[0]?.init, "Authorization")).toBeNull();
    fetchMock.mockResolvedValueOnce(json(200, { workspaces: "nope" }));
    expect(await api.listWorkspaces()).toEqual([]);
  });

  it("lists workspaces, and a caller abort mid-flight aborts the request with the caller's reason", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { workspaces: [{ id: "w1", slug: "ops", name: "Ops" }] }));
    expect(await api.listWorkspaces()).toEqual([expect.objectContaining({ id: "w1", slug: "ops", name: "Ops" })]);
    expect(calls()[0]?.url).toBe("https://uniwork.example/api/v1/workspaces");

    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("caller left", "AbortError"))),
        ),
    );
    const controller = new AbortController();
    const pending = api.listWorkspaces({ signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).rejects.toThrow("caller left");
    expect(calls()[1]?.init.signal?.aborted).toBe(true);
  });

  it("a caller signal that is already aborted aborts the request before it starts", async () => {
    fetchMock.mockImplementationOnce(async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return json(200, {});
    });
    const controller = new AbortController();
    controller.abort();
    await expect(api.listWorkspaces({ signal: controller.signal })).rejects.toThrow("aborted");
  });

  it("times out after 30 s with an ApiError status 0 (Hermes has no AbortSignal.timeout)", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
    );
    const pending = api.getMe();
    const settled = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toMatchObject({ name: "ApiError", status: 0, message: expect.stringMatching(/timed out/) });
  });

  it("posts and deletes push subscriptions with the Expo token and platform; 204 is fine", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.subscribePush({ endpoint: "ExponentPushToken[x]", keys: { p256dh: "", auth: "" }, platform: "ios" });
    fetchMock.mockResolvedValueOnce(json(200, { status: "ok" }));
    await api.unsubscribePush({ endpoint: "ExponentPushToken[x]" });
    const [sub, unsub] = calls();
    expect(sub?.url).toBe("https://uniwork.example/api/v1/me/push-subscriptions");
    expect(sub?.init.method).toBe("POST");
    expect(JSON.parse(String(sub?.init.body))).toEqual({
      endpoint: "ExponentPushToken[x]",
      keys: { p256dh: "", auth: "" },
      platform: "ios",
    });
    expect(unsub?.init.method).toBe("DELETE");
    expect(JSON.parse(String(unsub?.init.body))).toEqual({ endpoint: "ExponentPushToken[x]" });
  });

  it("wraps a non-2xx answer in ApiError with the server message, or the status text without one", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: { code: "not_found", message: "no such workspace" } }));
    await expect(api.listWorkspaces()).rejects.toMatchObject({ status: 404, message: "no such workspace" });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502, statusText: "Bad Gateway" }));
    const error = await api.listWorkspaces().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: "502 Bad Gateway", body: undefined });
    expect(sessionMock.refresh).not.toHaveBeenCalled();
  });

  describe("401", () => {
    it("refreshes once and retries with the new token", async () => {
      fetchMock.mockResolvedValueOnce(json(401, { error: { code: "unauthorized" } }));
      fetchMock.mockResolvedValueOnce(json(200, { user: { id: "u1" } }));
      const onUnauthorized = vi.fn();
      const client = createApiClient({ session: sessionMock, onUnauthorized });
      expect(await client.getMe()).toMatchObject({ id: "u1" });
      expect(sessionMock.refresh).toHaveBeenCalledTimes(1);
      expect(header(calls()[0]?.init, "Authorization")).toBe("Bearer at_1");
      expect(header(calls()[1]?.init, "Authorization")).toBe("Bearer at_2");
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it("a second 401 after the retry reports onUnauthorized once and throws; a later success re-arms it", async () => {
      const onUnauthorized = vi.fn();
      const client = createApiClient({ session: sessionMock, onUnauthorized });
      fetchMock.mockResolvedValue(json(401, { error: { code: "unauthorized" } }));
      await expect(client.getMe()).rejects.toMatchObject({ status: 401 });
      await expect(client.listWorkspaces()).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(sessionMock.refresh).toHaveBeenCalledTimes(2);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      fetchMock.mockResolvedValueOnce(json(200, { workspaces: [] }));
      await client.listWorkspaces();
      fetchMock.mockResolvedValue(json(401, { error: { code: "unauthorized" } }));
      await expect(client.getMe()).rejects.toMatchObject({ status: 401 });
      expect(onUnauthorized).toHaveBeenCalledTimes(2);
    });

    it("a refresh that yields no token (session ended or unreachable) reports onUnauthorized without a retry", async () => {
      sessionMock.refresh.mockResolvedValue(null);
      const onUnauthorized = vi.fn();
      const client = createApiClient({ session: sessionMock, onUnauthorized });
      fetchMock.mockResolvedValueOnce(json(401, {}));
      await expect(client.getMe()).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it("never refreshes for the native auth routes themselves", async () => {
      fetchMock.mockResolvedValueOnce(json(401, {}));
      const onUnauthorized = vi.fn();
      const client = createApiClient({ session: sessionMock, onUnauthorized });
      await expect(client.request("/api/v1/auth/desktop/logout", { method: "POST" })).rejects.toMatchObject({ status: 401 });
      expect(sessionMock.refresh).not.toHaveBeenCalled();
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it("the shared client works without a hook and takes one later (the app wires its sign-out there)", async () => {
      sessionMock.refresh.mockResolvedValue(null);
      fetchMock.mockResolvedValue(json(401, {}));
      await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
      const onUnauthorized = vi.fn();
      api.setOnUnauthorized(onUnauthorized);
      fetchMock.mockResolvedValueOnce(json(200, { workspaces: [] }));
      await api.listWorkspaces();
      await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
  });
});
