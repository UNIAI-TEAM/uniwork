import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useGraphNeighbors, useGraphUI } from "./hooks";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("useGraphUI", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
    setAccessToken("tok");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("reads the organization's own answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} }));
    const { result } = renderHook(() => useGraphUI("o1"), { wrapper });
    await waitFor(() => expect(result.current).toBe("on"));
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("/api/v1/config?organization_id=o1");
  });

  it("is off without an organization and unknown when the answer drifts", async () => {
    expect(renderHook(() => useGraphUI(undefined), { wrapper }).result.current).toBe("off");
    // A fresh Response per call: the hook retries once, a second later.
    vi.mocked(fetch).mockImplementation(async () => json({ flags: {} }));
    const { result } = renderHook(() => useGraphUI("o2"), { wrapper });
    await waitFor(() => expect(result.current).toBe("unknown"), { timeout: 4_000 });
  });
});

describe("useGraphNeighbors", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
    setAccessToken("tok");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("reads one page of 100 and does not retry a node that is hidden or not projected yet", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ error: { code: "not_found", message: "not found" } }, 404));
    const { result } = renderHook(() => useGraphNeighbors("w1", "TASK", "t1", { enabled: true }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("/api/v1/workspaces/w1/graph/nodes/TASK/t1/neighbors?limit=100");
  });
});
