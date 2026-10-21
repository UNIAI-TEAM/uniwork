import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useBulkDocumentCommand, useDocumentDownloadJob } from "./hooks-bulk";
import { documentKeys } from "./keys";

// UNI-2045 W9: the bulk hooks reuse the single-document endpoints, fan out
// through runBulk and invalidate the workspace document root once, after the
// whole batch; the zip hook creates an SV-9 job and polls it to an end.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const doc = (id: string) => ({
  id,
  organization_id: "o1",
  workspace_id: "w1",
  kind: "file",
  title: `Tệp ${id}`,
  visibility: "workspace",
  revision: "7",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
});

const archive = (id: string) => ({ document: { ...doc(id), archived_at: "2026-10-21T01:00:00Z" }, batch_id: "b1", affected: [id] });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, invalidate, wrapper };
}

const pathOf = (input: unknown) => new URL(String(input)).pathname;

describe("useBulkDocumentCommand", () => {
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

  it("trashes every id through /archive, counts a 403 and invalidates once", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = pathOf(input);
      if (path === "/api/v1/documents/d2/archive") return json({ error: { code: "forbidden", message: "no" } }, 403);
      const id = path.split("/")[4]!;
      return json(archive(id));
    });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useBulkDocumentCommand("w1"), { wrapper });
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ command: "trash", ids: ["d1", "d2", "d3"] });
    });
    expect(out).toEqual({ ok: ["d1", "d3"], failed: [{ id: "d2", code: "forbidden" }] });
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => pathOf(input));
    expect(paths.sort()).toEqual(["/api/v1/documents/d1/archive", "/api/v1/documents/d2/archive", "/api/v1/documents/d3/archive"]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: documentKeys.workspace("w1") });
  });

  it("moves each id onto the one target with the revision it reads first", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = pathOf(input);
      const id = path.split("/")[4]!;
      return json({ document: doc(id) });
    });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useBulkDocumentCommand("w1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ command: "move", ids: ["d1", "d2"], parentId: "f9" });
    });
    const moves = vi.mocked(fetch).mock.calls.filter(([input]) => pathOf(input).endsWith("/move"));
    expect(moves).toHaveLength(2);
    for (const [, init] of moves) expect(JSON.parse(String(init?.body))).toEqual({ parent_id: "f9", revision: "7" });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["shelve", "/shelve"],
    ["unshelve", "/unshelve"],
    ["restore", "/restore"],
    ["purge", "/purge"],
  ] as const)("%s posts to %s for each id", async (command, suffix) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const id = pathOf(input).split("/")[4]!;
      return command === "purge" ? new Response(null, { status: 204 }) : json(archive(id));
    });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useBulkDocumentCommand("w1"), { wrapper });
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ command, ids: ["d1", "d2"] });
    });
    expect(out?.ok).toEqual(["d1", "d2"]);
    expect(vi.mocked(fetch).mock.calls.every(([input]) => pathOf(input).endsWith(suffix))).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("useDocumentDownloadJob", () => {
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

  const job = (status: string, over: Record<string, unknown> = {}) => ({
    id: "job1",
    status,
    created_at: "2026-10-21T01:00:00Z",
    expires_at: null,
    download_url: null,
    file_count: null,
    skipped: [],
    error: null,
    ...over,
  });

  it("creates the job, polls it until ready and answers the ready job", async () => {
    const answers = [job("running"), job("ready", { download_url: "https://files.test/z", file_count: 2 })];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "POST") return json(job("queued"), 202);
      return json(answers.shift() ?? job("ready"));
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDocumentDownloadJob("w1", { pollMs: 1 }), { wrapper });
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync(["d1", "d2"]);
    });
    expect(out?.status).toBe("ready");
    expect(out?.download_url).toBe("https://files.test/z");
    const gets = vi.mocked(fetch).mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET");
    expect(gets).toHaveLength(2);
    expect(pathOf(gets[0]![0])).toBe("/api/v1/workspaces/w1/documents/download-jobs/job1");
  });

  it("stops at a failed job, and at the poll cap with the last state", async () => {
    vi.mocked(fetch).mockImplementation(async (_input, init) => (init?.method === "POST" ? json(job("queued"), 202) : json(job("failed", { error: "boom" }))));
    const { wrapper } = setup();
    const failed = renderHook(() => useDocumentDownloadJob("w1", { pollMs: 1 }), { wrapper });
    await act(async () => {
      await expect(failed.result.current.mutateAsync(["d1", "d2"])).resolves.toMatchObject({ status: "failed" });
    });

    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockImplementation(async (_input, init) => (init?.method === "POST" ? json(job("queued"), 202) : json(job("running"))));
    const capped = renderHook(() => useDocumentDownloadJob("w1", { pollMs: 1, maxPolls: 3 }), { wrapper });
    await act(async () => {
      await expect(capped.result.current.mutateAsync(["d1", "d2"])).resolves.toMatchObject({ status: "running" });
    });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET")).toHaveLength(3);
  });

  it("stops polling when the screen unmounts: no further read, and the call ends instead of answering a link", async () => {
    vi.mocked(fetch).mockImplementation(async (_input, init) => (init?.method === "POST" ? json(job("queued"), 202) : json(job("running"))));
    const { wrapper } = setup();
    const { result, unmount } = renderHook(() => useDocumentDownloadJob("w1", { pollMs: 5 }), { wrapper });
    const settled = result.current.mutateAsync(["d1", "d2"]).then(
      () => "answered",
      () => "stopped",
    );
    const reads = () => vi.mocked(fetch).mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET").length;
    await vi.waitFor(() => expect(reads()).toBeGreaterThanOrEqual(1));
    unmount();
    await expect(settled).resolves.toBe("stopped");
    const after = reads();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(reads()).toBe(after);
  });
});
