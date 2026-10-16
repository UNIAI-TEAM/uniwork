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
  useShareDocumentBatch,
} from "./hooks-sharing";
import { documentKeys } from "./keys";
import { sharePrincipalsNotInOrganization } from "./errors";

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
    const { result } = renderHook(() => useShareDocument("w1", "d1", "w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ principal_type: "user", principal_id: "u2", level: "view" });
    });
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(true);

    vi.mocked(fetch).mockResolvedValueOnce(json({ share: { id: "s2" } }));
    const second = renderHook(() => useShareDocument("w1", "d1", "w1"), { wrapper });
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

  it("useShareDocument accepts the merged home-row answer and refuses every other empty id", async () => {
    // SH-S1: a share naming the document's own workspace is merged into its
    // home row, so the answer carries the moved grant with an EMPTY share id
    // and still proves the write the caller asked for.
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ share: share({ id: "", principal_type: "workspace", principal_id: "w1" }) }),
    );
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.shares("w1", "d1"), { my_level: "manage", via: "member" });
    qc.setQueryData(documentKeys.detail("w1", "d1"), { id: "d1" });
    const { result } = renderHook(() => useShareDocument("w1", "d1", "w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ principal_type: "workspace", principal_id: "w1", level: "view" });
    });
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.detail("w1", "d1"))?.isInvalidated).toBe(true);

    // The same empty id for another workspace, or for a principal that is not
    // a workspace, is still an unverifiable answer.
    for (const row of [
      share({ id: "", principal_type: "workspace", principal_id: "w2" }),
      share({ id: "", principal_type: "user", principal_id: "w1" }),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(json({ share: row }));
      const next = renderHook(() => useShareDocument("w1", "d1", "w1"), { wrapper });
      await act(async () => {
        await expectNotVerifiable(() =>
          next.result.current.mutateAsync({
            principal_type: "workspace",
            principal_id: "w1",
            level: "view",
          }),
        );
      });
    }
  });

  it("useShareDocument judges the merged answer by the document's workspace, not the route's (BE-SHS1-20)", async () => {
    // Route/cache workspace w1, document home w2: the merged w2 answer is the
    // write; the same answer for the route workspace is not.
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ share: share({ id: "", principal_type: "workspace", principal_id: "w2" }) }),
    );
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.shares("w1", "d1"), { my_level: "manage", via: "member" });
    qc.setQueryData(documentKeys.detail("w1", "d1"), { id: "d1" });
    const { result } = renderHook(() => useShareDocument("w1", "d1", "w2"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ principal_type: "workspace", principal_id: "w2", level: "view" });
    });
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.detail("w1", "d1"))?.isInvalidated).toBe(true);

    vi.mocked(fetch).mockResolvedValueOnce(
      json({ share: share({ id: "", principal_type: "workspace", principal_id: "w1" }) }),
    );
    const other = renderHook(() => useShareDocument("w1", "d1", "w2"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() =>
        other.result.current.mutateAsync({ principal_type: "workspace", principal_id: "w1", level: "view" }),
      );
    });

    // A missing document workspace never falls back to the route's.
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ share: share({ id: "", principal_type: "workspace", principal_id: "w1" }) }),
    );
    const missing = renderHook(() => useShareDocument("w1", "d1", ""), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() =>
        missing.result.current.mutateAsync({ principal_type: "workspace", principal_id: "w1", level: "view" }),
      );
    });
  });

  it("useShareDocumentBatch invalidates what useShareDocument does and refuses an unverifiable answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ shares: [share({ id: "s1", principal_id: "u2" }), share({ id: "s2", principal_id: "u3" })] }),
    );
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.shares("w1", "d1"), { my_level: "manage", via: "member" });
    qc.setQueryData(documentKeys.detail("w1", "d1"), { id: "d1" });
    const { result } = renderHook(() => useShareDocumentBatch("w1", "d1"), { wrapper });
    await act(async () => {
      const out = await result.current.mutateAsync({ principal_ids: ["u2", "u3"], level: "view" });
      expect(out.shares).toHaveLength(2);
    });
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(documentKeys.detail("w1", "d1"))?.isInvalidated).toBe(true);

    // One row without its identity makes the whole answer unverifiable.
    vi.mocked(fetch).mockResolvedValueOnce(json({ shares: [share(), share({ principal_id: "" })] }));
    const second = renderHook(() => useShareDocumentBatch("w1", "d1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() =>
        second.result.current.mutateAsync({ principal_ids: ["u2", "u3"], level: "view" }),
      );
    });

    vi.mocked(fetch).mockResolvedValueOnce(json({ shares: [] }));
    const third = renderHook(() => useShareDocumentBatch("w1", "d1"), { wrapper });
    await act(async () => {
      await expectNotVerifiable(() =>
        third.result.current.mutateAsync({ principal_ids: ["u2"], level: "view" }),
      );
    });
  });

  it("useShareDocumentBatch surfaces the refused principal ids of a 422", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        {
          error: {
            code: "principal_not_in_organization",
            message: "not in organization",
            fields: { principal_ids: ["u9", 7, "u8"] },
          },
        },
        422,
      ),
    );
    const { qc, wrapper } = setup();
    qc.setQueryData(documentKeys.shares("w1", "d1"), { my_level: "manage", via: "member" });
    const { result } = renderHook(() => useShareDocumentBatch("w1", "d1"), { wrapper });
    let caught: unknown = null;
    await act(async () => {
      caught = await result.current
        .mutateAsync({ principal_ids: ["u2", "u9", "u8"], level: "view" })
        .then(() => null, (e: unknown) => e);
    });
    // Non-string entries are dropped rather than trusted.
    expect(sharePrincipalsNotInOrganization(caught)).toEqual(["u9", "u8"]);
    expect(qc.getQueryState(documentKeys.shares("w1", "d1"))?.isInvalidated).toBe(false);
    expect(sharePrincipalsNotInOrganization(new Error("offline"))).toBeNull();
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
