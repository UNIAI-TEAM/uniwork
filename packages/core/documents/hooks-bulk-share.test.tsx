import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useBulkShareDocuments, type BulkShareResult } from "./hooks-bulk-share";
import { documentKeys } from "./keys";

// UNI-2045 W13: sharing several documents fans out over the single-document
// routes the share dialog uses (PUT /access, POST /links, GET /shares +
// DELETE /links/{id}), at most four documents at a time, and invalidates the
// workspace document root once after the batch.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const accessAnswer = (count: number) => ({
  batch_id: "b1",
  dry_run: false,
  results: Array.from({ length: count }, (_, index) => ({ index, status: "granted" })),
  preview: { users: [], groups: [], warnings: [] },
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { invalidate, wrapper };
}

const pathOf = (input: unknown) => new URL(String(input)).pathname;
const bodyOf = (init: unknown) => JSON.parse(String((init as RequestInit | undefined)?.body ?? "null")) as unknown;

describe("useBulkShareDocuments", () => {
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

  it("sends the same people and each document's own workspace to PUT /access, one call per document", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = pathOf(input);
      if (path === "/api/v1/documents/d2/access") return json({ error: { code: "forbidden", message: "no" } }, 403);
      return json(accessAnswer(2));
    });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useBulkShareDocuments("w1"), { wrapper });
    let out: BulkShareResult | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        docs: [
          { id: "d1", workspace_id: "w1" },
          { id: "d2", workspace_id: "w1" },
          { id: "d3", workspace_id: "w9" },
        ],
        people: [{ principal_type: "user", principal_id: "u2", level: "edit" }],
        onExisting: "keep",
        workspace: "view",
        link: "keep",
      });
    });
    expect(out).toEqual({ ok: ["d1", "d3"], failed: [{ id: "d2", code: "forbidden" }], links: [] });
    const calls = vi.mocked(fetch).mock.calls.map(([input, init]) => ({ path: pathOf(input), body: bodyOf(init) }));
    expect(calls.map((c) => c.path).sort()).toEqual(["/api/v1/documents/d1/access", "/api/v1/documents/d2/access", "/api/v1/documents/d3/access"]);
    expect(calls.find((c) => c.path.includes("/d3/"))?.body).toEqual({
      items: [
        { principal_type: "user", principal_id: "u2", level: "edit", on_existing: "keep" },
        { principal_type: "workspace", principal_id: "w9", level: "view", on_existing: "update" },
      ],
      dry_run: false,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.workspace("w1") });
  });

  it("removes the workspace grant with a null level and no on_existing", async () => {
    vi.mocked(fetch).mockImplementation(async () => json(accessAnswer(1)));
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkShareDocuments("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ docs: [{ id: "d1", workspace_id: "w1" }], people: [], onExisting: "keep", workspace: "none", link: "keep" });
    });
    expect(bodyOf(vi.mocked(fetch).mock.calls[0]![1])).toEqual({
      items: [{ principal_type: "workspace", principal_id: "w1", level: null }],
      dry_run: false,
    });
  });

  it("creates one link per document with the expiry and returns each URL once", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const id = pathOf(input).split("/")[4]!;
      return json({ link: { id: `l-${id}` }, token: "t", url: `/share/${id}` }, 201);
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkShareDocuments("w1"), { wrapper });
    let out: BulkShareResult | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        docs: [
          { id: "d1", workspace_id: "w1" },
          { id: "d2", workspace_id: "w1" },
        ],
        people: [],
        onExisting: "keep",
        workspace: "keep",
        link: "create",
        expiresInDays: 30,
      });
    });
    const calls = vi.mocked(fetch).mock.calls.map(([input, init]) => ({ path: pathOf(input), method: (init as RequestInit).method, body: bodyOf(init) }));
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.method === "POST" && /\/links$/.test(c.path))).toBe(true);
    expect(calls[0]!.body).toEqual({ expires_in_days: 30 });
    expect(out?.links).toEqual([
      { id: "d1", url: "/share/d1" },
      { id: "d2", url: "/share/d2" },
    ]);
  });

  it("turns links off by revoking every live link the document lists", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = pathOf(input);
      if ((init as RequestInit).method === "DELETE") return new Response(null, { status: 204 });
      if (path === "/api/v1/documents/d1/shares") return json({ my_level: "manage", links: [{ id: "l1" }, { id: "l2" }] });
      return json({});
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkShareDocuments("w1"), { wrapper });
    let out: BulkShareResult | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ docs: [{ id: "d1", workspace_id: "w1" }], people: [], onExisting: "keep", workspace: "keep", link: "revoke" });
    });
    const deleted = vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit).method === "DELETE").map(([input]) => pathOf(input));
    expect(deleted).toEqual(["/api/v1/documents/d1/links/l1", "/api/v1/documents/d1/links/l2"]);
    expect(out?.ok).toEqual(["d1"]);
  });

  it("counts an answer it cannot verify as not_verifiable", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ nope: true }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkShareDocuments("w1"), { wrapper });
    let out: BulkShareResult | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({
        docs: [{ id: "d1", workspace_id: "w1" }],
        people: [{ principal_type: "user", principal_id: "u2", level: "view" }],
        onExisting: "keep",
        workspace: "keep",
        link: "keep",
      });
    });
    expect(out?.failed).toEqual([{ id: "d1", code: "not_verifiable" }]);
  });

  it("runs at most four documents at once", async () => {
    let live = 0;
    let peak = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return json(accessAnswer(1));
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useBulkShareDocuments("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        docs: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, workspace_id: "w1" })),
        people: [{ principal_type: "user", principal_id: "u2", level: "view" }],
        onExisting: "keep",
        workspace: "keep",
        link: "keep",
      });
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(9);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
