import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { User } from "../types/user";
import { clearResolvedFiles, fileKeys, useResolvedUploads } from "./index";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const userA: User = {
  id: "uA",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const userB: User = { ...userA, id: "uB", email: "b@b.c", display_name: "B" };

const resolved = (url: string) =>
  json({
    items: [
      {
        file_id: "f1",
        file: { id: "f1", filename: "a.png", content_type: "image/png", size_bytes: 3, status: "ready" },
        access: "proxy",
        url,
        url_expires_at: "2026-09-26T21:00:00Z",
      },
    ],
  });

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useResolvedUploads", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
    resetAuthStoreForTests();
  });

  it("keys the answer by principal, workspace, disposition and ids", async () => {
    useAuthStore.getState().setUser(userA);
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(resolved("/api/v1/files/f1/content?ticket=a"));
    const { result } = renderHook(() => useResolvedUploads("ws1", ["f1"]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.url).toBe("http://api.test/api/v1/files/f1/content?ticket=a");
    expect(qc.getQueryData(fileKeys.uploadBatch("uA", "ws1", ["f1"], "inline"))).toBeDefined();
    expect(fileKeys.uploadBatch("uA", "ws1", ["f1"], "inline")).not.toEqual(
      fileKeys.uploadBatch("uB", "ws1", ["f1"], "inline"),
    );
    expect(fileKeys.uploadBatch("uA", "ws1", ["f1"], "inline")).not.toEqual(
      fileKeys.uploadBatch("uA", "ws2", ["f1"], "inline"),
    );
  });

  it("never serves one account's answer to another", async () => {
    useAuthStore.getState().setUser(userA);
    const { wrapper } = setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce(resolved("/api/v1/files/f1/content?ticket=a"))
      .mockResolvedValueOnce(resolved("/api/v1/files/f1/content?ticket=b"));
    const { result, rerender } = renderHook(() => useResolvedUploads("ws1", ["f1"]), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]?.url).toContain("ticket=a"));

    useAuthStore.getState().setUser(userB);
    rerender();
    await waitFor(() => expect(result.current.data?.[0]?.url).toContain("ticket=b"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not resolve while signed out or without ids", () => {
    const { wrapper } = setup();
    const anon = renderHook(() => useResolvedUploads("ws1", ["f1"]), { wrapper });
    expect(anon.result.current.fetchStatus).toBe("idle");
    anon.unmount();
    useAuthStore.getState().setUser(userA);
    renderHook(() => useResolvedUploads("ws1", []), { wrapper });
    renderHook(() => useResolvedUploads("", ["f1"]), { wrapper });
    renderHook(() => useResolvedUploads("ws1", ["f1"], { enabled: false }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never re-resolves on a timer, on focus, on reconnect or after the URL expires", async () => {
    useAuthStore.getState().setUser(userA);
    const { qc, wrapper } = setup();
    vi.mocked(fetch).mockResolvedValue(resolved("/api/v1/files/f1/content?ticket=a"));
    const { result } = renderHook(() => useResolvedUploads("ws1", ["f1"]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = qc.getQueryCache().find({
      queryKey: fileKeys.uploadBatch("uA", "ws1", ["f1"], "inline"),
    });
    const opts = query?.options as Record<string, unknown>;
    expect(opts.refetchInterval).toBe(false);
    expect(opts.refetchOnWindowFocus).toBe(false);
    expect(opts.refetchOnReconnect).toBe(false);
    expect(opts.retry).toBe(false);
    expect(opts.staleTime).toBe(Infinity);

    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed resolve", async () => {
    useAuthStore.getState().setUser(userA);
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValue(json({ error: { code: "forbidden", message: "forbidden" } }, 403));
    const { result } = renderHook(() => useResolvedUploads("ws1", ["f1"]), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("clearResolvedFiles drops one principal or every principal", () => {
    const { qc } = setup();
    qc.setQueryData(fileKeys.uploadBatch("uA", "ws1", ["f1"], "inline"), []);
    qc.setQueryData(fileKeys.uploadBatch("uB", "ws1", ["f1"], "inline"), []);
    qc.setQueryData(["tasks", "ws1"], []);
    clearResolvedFiles(qc, "uA");
    expect(qc.getQueryData(fileKeys.uploadBatch("uA", "ws1", ["f1"], "inline"))).toBeUndefined();
    expect(qc.getQueryData(fileKeys.uploadBatch("uB", "ws1", ["f1"], "inline"))).toEqual([]);
    clearResolvedFiles(qc);
    expect(qc.getQueryData(fileKeys.uploadBatch("uB", "ws1", ["f1"], "inline"))).toBeUndefined();
    expect(qc.getQueryData(["tasks", "ws1"])).toEqual([]);
  });
});
