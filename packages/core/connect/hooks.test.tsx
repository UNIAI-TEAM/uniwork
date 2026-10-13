import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "../api/endpoints/connect";
import {
  connectKeys,
  useMcpPolicy,
  useMyConnectedApps,
  useOrgConnectedApps,
  useRevokeMyConnectedApp,
  useRevokeOrgConnectedApp,
  useSetMcpPolicy,
} from "./hooks";

vi.mock("../api/endpoints/connect");

const grant: endpoints.ConnectedApp = {
  id: "g1",
  organization_id: "o1",
  organization_name: "Acme",
  user_id: "u1",
  user_name: "Minh",
  client_id: "c1",
  client_name: "Claude",
  verified: true,
  scope: "read",
  created_at: "2026-10-12T08:00:00Z",
  last_used_at: null,
};

const policy: endpoints.McpPolicy = {
  enabled: true,
  available: true,
  enabled_at: null,
  enabled_by: "",
  mcp_url: "https://api.example.test/mcp",
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, wrapper: Wrapper };
}

describe("connect hooks", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keys nest under one root and carry the organization slug", () => {
    expect(connectKeys.mine()).toEqual(["connect", "mine"]);
    expect(connectKeys.org("acme")).toEqual(["connect", "org", "acme"]);
    expect(connectKeys.policy("acme")).toEqual(["connect", "policy", "acme"]);
    expect(connectKeys.org("acme")).not.toEqual(connectKeys.org("beta"));
  });

  it("loads my connected apps", async () => {
    vi.mocked(endpoints.listMyConnectedApps).mockResolvedValue({ grants: [grant], mcp_url: policy.mcp_url });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyConnectedApps(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.grants[0]?.id).toBe("g1");
    expect(result.current.data?.mcp_url).toBe(policy.mcp_url);
  });

  it("my connected apps stay idle when switched off", async () => {
    vi.mocked(endpoints.listMyConnectedApps).mockResolvedValue({ grants: [grant], mcp_url: policy.mcp_url });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyConnectedApps({ enabled: false }), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(endpoints.listMyConnectedApps).not.toHaveBeenCalled();
  });

  it("revoking my own app refetches my list", async () => {
    vi.mocked(endpoints.revokeMyConnectedApp).mockResolvedValue(undefined);
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRevokeMyConnectedApp(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("g1");
    });
    expect(endpoints.revokeMyConnectedApp).toHaveBeenCalledWith("g1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: connectKeys.mine() });
  });

  it("the organization list is idle without a slug or when switched off", async () => {
    vi.mocked(endpoints.listOrgConnectedApps).mockResolvedValue([grant]);
    const { wrapper } = setup();
    const noSlug = renderHook(() => useOrgConnectedApps(""), { wrapper });
    const off = renderHook(() => useOrgConnectedApps("acme", { enabled: false }), { wrapper });
    expect(noSlug.result.current.fetchStatus).toBe("idle");
    expect(off.result.current.fetchStatus).toBe("idle");
    expect(endpoints.listOrgConnectedApps).not.toHaveBeenCalled();

    const on = renderHook(() => useOrgConnectedApps("acme"), { wrapper });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(endpoints.listOrgConnectedApps).toHaveBeenCalledWith("acme");
    expect(on.result.current.data).toHaveLength(1);
  });

  it("revoking in the organization refetches both lists", async () => {
    vi.mocked(endpoints.revokeOrgConnectedApp).mockResolvedValue(undefined);
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRevokeOrgConnectedApp("acme"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("g1");
    });
    expect(endpoints.revokeOrgConnectedApp).toHaveBeenCalledWith("acme", "g1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: connectKeys.org("acme") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: connectKeys.mine() });
  });

  it("the policy is idle without a slug or when switched off, and loads otherwise", async () => {
    vi.mocked(endpoints.getMcpPolicy).mockResolvedValue(policy);
    const { wrapper } = setup();
    const noSlug = renderHook(() => useMcpPolicy(""), { wrapper });
    const off = renderHook(() => useMcpPolicy("acme", { enabled: false }), { wrapper });
    expect(noSlug.result.current.fetchStatus).toBe("idle");
    expect(off.result.current.fetchStatus).toBe("idle");

    const on = renderHook(() => useMcpPolicy("acme"), { wrapper });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(on.result.current.data?.enabled).toBe(true);
    expect(endpoints.getMcpPolicy).toHaveBeenCalledTimes(1);
  });

  it("switching the policy writes the answer into the cache", async () => {
    vi.mocked(endpoints.setMcpPolicy).mockResolvedValue({ ...policy, enabled: false });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useSetMcpPolicy("acme"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(false);
    });
    expect(endpoints.setMcpPolicy).toHaveBeenCalledWith("acme", false);
    expect(qc.getQueryData<endpoints.McpPolicy>(connectKeys.policy("acme"))?.enabled).toBe(false);
  });

  it("a policy answer that does not parse fails the switch and leaves the cache alone", async () => {
    vi.mocked(endpoints.setMcpPolicy).mockResolvedValue(null);
    const { qc, wrapper } = setup();
    qc.setQueryData(connectKeys.policy("acme"), policy);
    const { result } = renderHook(() => useSetMcpPolicy("acme"), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(false)).rejects.toThrow("mcp policy response did not parse");
    });
    expect(qc.getQueryData<endpoints.McpPolicy>(connectKeys.policy("acme"))?.enabled).toBe(true);
  });
});
