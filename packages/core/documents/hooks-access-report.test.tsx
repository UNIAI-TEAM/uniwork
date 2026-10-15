import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useDocumentAccessReport } from "./hooks-access-report";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const page = (docId: string, next: string | null, over: Record<string, unknown> = {}) => ({
  scope: { kind: "workspace", workspace_id: "w1", folder_id: null, folder_title: null },
  filter: { person_id: null, level: [], visibility: null },
  generated_at: "2026-10-15T03:40:00Z",
  documents: [
    {
      document: { id: docId, title: docId, kind: "file", visibility: "workspace", path: [], acl_owner: null, live_link_count: 0, updated_at: "" },
      rows: [],
    },
  ],
  summary: { candidates: 1, documents: 1, rows: 0, skipped: 1 },
  next_cursor: next,
  ...over,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useDocumentAccessReport (UNI-1643)", () => {
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

  it("pages on next_cursor and stops when it is null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(page("d1", "c2")))
      .mockResolvedValueOnce(json(page("d2", null)));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReport("w1", "f1", { levels: ["edit"] }), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    const first = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(first.searchParams.get("folder_id")).toBe("f1");
    expect(first.searchParams.get("level")).toBe("edit");
    expect(first.searchParams.has("cursor")).toBe(false);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(result.current.data?.pages.flatMap((p) => p.documents.map((d) => d.document.id))).toEqual(["d1", "d2"]),
    );
    expect(new URL(String(vi.mocked(fetch).mock.calls[1]![0])).searchParams.get("cursor")).toBe("c2");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("keys the entry by workspace, folder and the normalized filters", () => {
    const base = documentKeys.accessReport("w1", "f1", { levels: ["edit", "view"], personId: "u1" });
    expect(base.slice(0, 2)).toEqual(["documents", "w1"]);
    expect(base).toContain("f1");
    // Level order and empty filters never split one report across two entries.
    expect(documentKeys.accessReport("w1", "f1", { levels: ["view", "edit"], personId: "u1" })).toEqual(base);
    expect(documentKeys.accessReport("w1", "f1", { personId: "u2" })).not.toEqual(base);
    expect(documentKeys.accessReport("w2", "f1", { levels: ["edit", "view"], personId: "u1" })).not.toEqual(base);
    expect(documentKeys.accessReport("w1", undefined, {})).toEqual(documentKeys.accessReport("w1", "", { levels: [] }));
    expect(documentKeys.accessReport("w1", "f2", { levels: ["edit", "view"], personId: "u1" })).not.toEqual(base);
  });

  it("fails the query when the answer is not a report, never an empty report", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentAccessReport("w1", undefined, {}), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch without a workspace or when disabled", () => {
    const { wrapper } = setup();
    renderHook(() => useDocumentAccessReport("", undefined, {}), { wrapper });
    renderHook(() => useDocumentAccessReport("w1", undefined, {}, { enabled: false }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });
});
