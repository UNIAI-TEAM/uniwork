import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useApproveDocumentAccessRequest } from "./hooks-access-decisions";
import { useUpdateDocument } from "./hooks";
import {
  useCreateDocumentLink,
  useRevokeDocumentLink,
  useRevokeDocumentShare,
  useShareDocument,
  useShareDocumentBatch,
  useUpdateDocumentAccess,
} from "./hooks-sharing";
import { documentKeys } from "./keys";

// UNI-2009: a library row's Access cell reads `share_scope` and `my_level` off
// the list the row came from, so a change made in the Share dialog opened from
// a row must refresh every list a row can come from, not only Shared by me.

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

const link = {
  id: "l1",
  expires_at: "2026-10-04T09:00:00Z",
  view_count: 0,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
};

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Tài liệu",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
  ...over,
});

/** Every list entry a library row is read from: home/folder, Recent, Shared with/by me, Lưu trữ (Starred reads the home root). */
const LIST_KEYS = {
  "home root": documentKeys.list("w1", ""),
  "folder (filtered)": documentKeys.list("w1", "folder=f1"),
  recent: documentKeys.recent("w1"),
  "recent (filtered)": documentKeys.recent("w1", "format=page"),
  "shared with me": documentKeys.sharedWithMe("w1"),
  "shared by me": documentKeys.sharedByMe("w1"),
  "shared by me (filtered)": documentKeys.sharedByMe("w1", "format=page"),
  shelved: documentKeys.shelved("w1"),
} as const;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const key of Object.values(LIST_KEYS)) qc.setQueryData(key, { pages: [], pageParams: [] });
  // Another workspace's lists are none of this document's business.
  qc.setQueryData(documentKeys.list("w2", ""), { pages: [], pageParams: [] });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function expectEveryListInvalidated(qc: QueryClient) {
  for (const [name, key] of Object.entries(LIST_KEYS)) {
    expect(qc.getQueryState(key)?.isInvalidated, name).toBe(true);
  }
  expect(qc.getQueryState(documentKeys.list("w2", ""))?.isInvalidated).toBe(false);
}

describe("share changes refresh every list a library row comes from (UNI-2009)", () => {
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

  it("a grant to one person", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ share: share() }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useShareDocument("w1", "d1", "w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ principal_type: "user", principal_id: "u2", level: "view" });
    });
    expectEveryListInvalidated(qc);
  });

  it("a grant to several people", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ shares: [share(), share({ id: "s2", principal_id: "u3" })] }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useShareDocumentBatch("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ principal_ids: ["u2", "u3"], level: "view" });
    });
    expectEveryListInvalidated(qc);
  });

  it("a revoked grant", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useRevokeDocumentShare("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("s1");
    });
    expectEveryListInvalidated(qc);
  });

  it("a new public link (the row's scope badge shows it)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ link, token: "t1", url: "/share/t1" }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateDocumentLink("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(7);
    });
    expectEveryListInvalidated(qc);
  });

  it("a revoked public link", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useRevokeDocumentLink("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("l1");
    });
    expectEveryListInvalidated(qc);
  });

  it("the unified access update, but not its dry-run preview", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useUpdateDocumentAccess("w1", "d1"), { wrapper });
    const items = [{ principal_type: "organization" as const, principal_id: "o1", level: "view" as const }];

    vi.mocked(fetch).mockResolvedValueOnce(
      json({ batch_id: "", dry_run: true, results: [{ index: 0, status: "granted" }], preview: { users: [], groups: [], warnings: [] } }),
    );
    await act(async () => {
      await result.current.mutateAsync({ items, dry_run: true });
    });
    for (const [name, key] of Object.entries(LIST_KEYS)) {
      expect(qc.getQueryState(key)?.isInvalidated, name).toBe(false);
    }

    vi.mocked(fetch).mockResolvedValueOnce(
      json({ batch_id: "01JABCDEF123", dry_run: false, results: [{ index: 0, status: "granted" }], preview: { users: [], groups: [], warnings: [] } }),
    );
    await act(async () => {
      await result.current.mutateAsync({ items, dry_run: false });
    });
    expectEveryListInvalidated(qc);
  });

  it("the workspace/restricted switch, but not a title-only patch", async () => {
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useUpdateDocument("w1", "d1"), { wrapper });

    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ title: "Mới", revision: "2" }) }));
    await act(async () => {
      await result.current.mutateAsync({ patch: { title: "Mới", revision: "1" } });
    });
    expect(qc.getQueryState(LIST_KEYS["home root"])?.isInvalidated).toBe(false);

    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ visibility: "restricted", revision: "3" }) }));
    await act(async () => {
      await result.current.mutateAsync({ patch: { visibility: "restricted", revision: "2" } });
    });
    expectEveryListInvalidated(qc);
  });

  it("an approved access request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "approved", share_id: "s1" }));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useApproveDocumentAccessRequest("w1", "d1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ requestId: "r1", level: "edit" });
    });
    expectEveryListInvalidated(qc);
  });
});
