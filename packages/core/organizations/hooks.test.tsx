import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { workspaceKeys } from "../workspaces/keys";
import { peopleKeys } from "../people/hooks";
import { organizationKeys, orgMemberKeys, useCloseOrganization, useTransferOwnership } from "./hooks";

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

describe("useTransferOwnership", () => {
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

  it("refreshes what the caller's role decides, and nothing else", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ member: { user_id: "u2", role: "owner" } }));
    const qc = seeded();
    const touched = [
      organizationKeys.list(),
      orgMemberKeys.me("acme"),
      orgMemberKeys.list("acme", "active"),
      peopleKeys.list("acme", {}),
      workspaceKeys.list(),
      workspaceKeys.me("w1"),
      workspaceKeys.members("w1"),
    ];
    const untouched = [["tasks", "w1"], orgMemberKeys.me("other-org"), ["meetings", "w1"]];
    for (const key of [...touched, ...untouched]) qc.setQueryData(key, { seeded: true });
    const { result } = renderHook(() => useTransferOwnership("acme"), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync({ toUserId: "u2", password: "pw" }));
    for (const key of touched) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    for (const key of untouched) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(false);
  });
});
