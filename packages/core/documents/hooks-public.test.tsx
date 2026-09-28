import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { usePublicDocument } from "./hooks-public";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("usePublicDocument (G1-05b)", () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("reads the anonymous view and keys it by token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ document: { title: "Chia sẻ", kind: "page", content: { type: "doc" } } }),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => usePublicDocument("t1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe("Chia sẻ");
    expect(qc.getQueryData(documentKeys.public("t1"))).toBeDefined();
    const init = vi.mocked(fetch).mock.calls[0]![1];
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });

  it("lands a revoked link in the error state instead of a cached document", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "not_found", message: "not found", error_class: "missing" } }, 404),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => usePublicDocument("t1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch without a token", () => {
    const { wrapper } = setup();
    renderHook(() => usePublicDocument(""), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("degrades a malformed body to null, never a fabricated document", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: { kind: "page" } }));
    const { wrapper } = setup();
    const { result } = renderHook(() => usePublicDocument("t1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
