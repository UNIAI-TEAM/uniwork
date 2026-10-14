import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { workspaceKeys } from "../workspaces/keys";
import { organizationKeys, useCloseOrganization } from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(organizationKeys.list(), [{ id: "o1", slug: "acme", name: "Acme" }]);
  qc.setQueryData(workspaceKeys.list(), [{ id: "w1" }]);
  return qc;
}

describe("useCloseOrganization", () => {
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

  it("drops the whole cache once the organization is closed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const qc = seeded();
    const { result } = renderHook(() => useCloseOrganization("acme"), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync("acme"));
    expect(qc.getQueryData(organizationKeys.list())).toBeUndefined();
    expect(qc.getQueryData(workspaceKeys.list())).toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/acme/close");
    expect(JSON.parse(String(init!.body))).toEqual({ confirm_slug: "acme" });
  });

  it("keeps the cache when the server refuses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "close_confirm_mismatch", message: "x" } }, 400),
    );
    const qc = seeded();
    const { result } = renderHook(() => useCloseOrganization("acme"), { wrapper: wrapperFor(qc) });
    await expect(act(() => result.current.mutateAsync("acm"))).rejects.toMatchObject({
      code: "close_confirm_mismatch",
    });
    expect(qc.getQueryData(organizationKeys.list())).toHaveLength(1);
  });
});
