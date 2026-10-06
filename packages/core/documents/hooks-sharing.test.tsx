import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { isDocumentNotVerifiable } from "../types/document";
import {
  useCreateDocumentLink,
  useDocumentAccessLogs,
  useDocumentSettings,
  useDocumentShares,
  useSetDocumentPublicLinks,
  useShareDocument,
} from "./hooks-sharing";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const share = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  principal_type: "user",
  principal_id: "u2",
  level: "view",
  active: true,
  granted_by: "u1",
  granted_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  ...over,
});

const link = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  expires_at: "2026-10-04T09:00:00Z",
  view_count: 0,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  ...over,
});

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

async function expectNotVerifiable(run: () => Promise<unknown>): Promise<void> {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(isDocumentNotVerifiable(err)).toBe(true);
}

describe("documents sharing hooks (G1-05b)", () => {
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

  it("useDocumentShares keys the overview under the document", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ my_level: "manage", via: "member", shares: [share()] }),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDocumentShares("w1", "d1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/documents/d1/shares",
    );
    expect(qc.getQueryData(documentKeys.shares("w1", "d1"))).toBeDefined();
  });

  it("useShareDocument invalidates the overview and refuses an unverifiable grant", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ share: share() }));
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.shares("w1", "d1"), { my_level: "manage", via: "member" });
    const { result } = renderHook(() => useShareDocument("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ principal_type: "user", principal_id: "u2", level: "view" });
    });
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(true);

    vi.mocked(fetch).mockResolvedValueOnce(json({ share: { id: "s2" } }));
    const second = renderHook(() => useShareDocument("w1", "d1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() =>
        second.result.current.mutateAsync({
          principal_type: "user",
          principal_id: "u2",
          level: "view",
        }),
      );
    });
  });

  it("useCreateDocumentLink verifies the one-time token and invalidates the overview", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ link: link(), token: "t1", url: "/share/t1" }));
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.shares("w1", "d1"), { my_level: "manage", via: "member" });
    const { result } = renderHook(() => useCreateDocumentLink("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(7);
    });
    // The observer publishes data after mutateAsync resolves; wait for it instead of racing the re-render.
    await waitFor(() => expect(result.current.data?.token).toBe("t1"));
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(true);

    vi.mocked(fetch).mockResolvedValueOnce(json({ link: link(), url: "/share/x" }));
    const second = renderHook(() => useCreateDocumentLink("w1", "d1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() => second.result.current.mutateAsync(7));
    });
  });

  it("useDocumentAccessLogs pages and keys the action separately", async () => {
    const row = {
      id: "g1",
      action: "view",
      via: "share",
      actor_kind: "human",
      actor_id: "u2",
      occurred_at: "2026-09-27T09:00:00Z",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ logs: [row], next_cursor: "c2" }))
      .mockResolvedValueOnce(json({ logs: [], next_cursor: null }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessLogs("w1", "d1", { action: "view" }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.logs.map((l) => l.id))).toEqual(["g1"]),
    );
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("action=view");
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toContain("cursor=c2");
  });

  it("useSetDocumentPublicLinks writes the settings entry and refuses an unverifiable one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization_id: "o1", public_links_enabled: true }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useSetDocumentPublicLinks("o1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(true);
    });
    expect(qc.getQueryData(documentKeys.settings("o1"))).toEqual({
      organization_id: "o1",
      public_links_enabled: true,
    });

    vi.mocked(fetch).mockResolvedValueOnce(json({ public_links_enabled: true }));
    const second = renderHook(() => useSetDocumentPublicLinks("o1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() => second.result.current.mutateAsync(false));
    });
  });

  it("useDocumentSettings reads the switch into the same cache entry (G1-08)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ organization_id: "o1", public_links_enabled: false }),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useDocumentSettings("o1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ organization_id: "o1", public_links_enabled: false });
    expect(qc.getQueryData(documentKeys.settings("o1"))).toEqual({
      organization_id: "o1",
      public_links_enabled: false,
    });

    // A malformed answer resolves null: the caller keeps its unknown state
    // instead of showing a fabricated switch position.
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const second = renderHook(() => useDocumentSettings("o2"), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(second.result.current.data).toBeNull();
  });
});
