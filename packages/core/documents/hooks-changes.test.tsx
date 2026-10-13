import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { documentChangesKeys } from "./changes-keys";
import { documentKeys } from "./keys";
import { useDocumentChanges } from "./hooks-changes";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const pageBody = (over: Record<string, unknown> = {}) => ({
  phase: "snapshot",
  changes: [{ document_id: "d1", kind: "file", revision: "41", current_version: 3, version_id: "v1" }],
  has_more: false,
  next_cursor: "dcc1.abc.sig",
  expires_at: "2026-10-13T10:15:00Z",
  ...over,
});

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("documentChangesKeys", () => {
  it("carries the workspace id and never collides across workspaces, cursors or limits", () => {
    expect(documentChangesKeys.page("w1", "", 0)).toEqual(["document-changes", "w1", "page", "", 0]);
    expect(documentChangesKeys.page("w1", "c1")).not.toEqual(documentChangesKeys.page("w2", "c1"));
    expect(documentChangesKeys.page("w1", "c1")).not.toEqual(documentChangesKeys.page("w1", "c2"));
    expect(documentChangesKeys.page("w1", "c1", 50)).not.toEqual(documentChangesKeys.page("w1", "c1", 100));
    expect(documentChangesKeys.page("w1", "c1").slice(0, 2)).toEqual(documentChangesKeys.workspace("w1"));
  });

  it("stays outside the documents root so a document.* realtime invalidation never refetches a cursor page", () => {
    expect(documentChangesKeys.workspace("w1")[0]).not.toBe(documentKeys.all[0]);
  });
});

describe("useDocumentChanges", () => {
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

  it("stays idle without a workspace id", () => {
    const { result } = renderHook(() => useDocumentChanges(""), { wrapper: wrapperFor(newClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens a snapshot without a cursor and caches the page under the workspace key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(pageBody()));
    const qc = newClient();
    const { result } = renderHook(() => useDocumentChanges("w1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/workspaces/w1/documents/changes");
    const data = result.current.data;
    expect(data?.kind).toBe("page");
    expect(data?.kind === "page" && data.page.changes[0]?.documentId).toBe("d1");
    expect(qc.getQueryData(documentChangesKeys.page("w1", ""))).toBe(data);
  });

  it("continues from the cursor and limit it is given", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(pageBody({ phase: "feed" })));
    const { result } = renderHook(() => useDocumentChanges("w1", { cursor: "dcc1.abc.sig", limit: 25 }), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/workspaces/w1/documents/changes?cursor=dcc1.abc.sig&limit=25",
    );
  });

  it("surfaces an expired cursor as a resync result, not an error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "change_cursor_expired", message: "gone" } }, 410));
    const { result } = renderHook(() => useDocumentChanges("w1", { cursor: "old" }), {
      wrapper: wrapperFor(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual({ kind: "resync", reason: "cursor_expired" });
  });

  it("surfaces a malformed answer as an unavailable result, not an error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const { result } = renderHook(() => useDocumentChanges("w1"), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ kind: "unavailable", reason: "malformed_response" });
  });

  it("lands other failures in the query's error state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "office_capability_off", message: "off" } }, 403));
    const { result } = renderHook(() => useDocumentChanges("w1"), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: "office_capability_off", status: 403 });
  });

  it("honours enabled: false", () => {
    const { result } = renderHook(() => useDocumentChanges("w1", { enabled: false }), {
      wrapper: wrapperFor(newClient()),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();
  });
});
