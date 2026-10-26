import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useDocumentMediaBlob } from "./hooks-media";
import { documentKeys } from "./keys";

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useDocumentMediaBlob", () => {
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

  it("types the bytes with the document's MIME and caches them per version", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "application/octet-stream" } }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDocumentMediaBlob("w1", "d1", "v2", "image/png"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.type).toBe("image/png");
    expect(result.current.data?.size).toBe(3);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(
      "http://api.test/api/v1/documents/d1/download?intent=view",
    );
    expect(qc.getQueryData(documentKeys.media("w1", "d1", "v2"))).toBeInstanceOf(Blob);

    await qc.invalidateQueries({ queryKey: documentKeys.workspace("w1") });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("stays idle without a version id and reports a failed download", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrapperFor(qc);
    const idle = renderHook(() => useDocumentMediaBlob("w1", "d1", "", "image/png"), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");

    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const failed = renderHook(() => useDocumentMediaBlob("w1", "d1", "v3", "image/png"), { wrapper });
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
  });
});
