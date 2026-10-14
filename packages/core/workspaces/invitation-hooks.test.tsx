import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { useAuthStore } from "../auth/store";
import { resetAuthStoreForTests } from "../auth/store";
import { setSessionUser } from "../auth/hooks";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { User } from "../types/user";
import { useAcceptInvite, useInvitationPreview } from "./hooks";
import { workspaceKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const user: User = {
  id: "u1",
  email: "ha@acme.vn",
  display_name: "Hà",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarded_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
};

function wrapperFor(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const preview = {
  invitation: {
    id: "i1",
    status: "pending",
    expires_at: "2026-10-20T00:00:00Z",
    organization: { id: "o2", slug: "beta", name: "Beta" },
    org_role: "member",
  },
  conflicts: [],
};

describe("invitation hooks", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("useInvitationPreview caches the preview under the token's key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(preview));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useInvitationPreview("t1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData(["invitation-preview", "t1"])).toEqual(result.current.data);
    expect(result.current.data?.invitation.organization.name).toBe("Beta");
  });

  it("useInvitationPreview stays idle while disabled", () => {
    const qc = new QueryClient();
    renderHook(() => useInvitationPreview("t1", false), { wrapper: wrapperFor(qc) });
    expect(fetch).not.toHaveBeenCalled();
  });

  /**
   * AC-15: the switch changes which organization every cached list belongs
   * to, so nothing from before survives, and the session user (now
   * onboarded) is read again without signing in.
   */
  it("useAcceptInvite drops the cache, then refreshes the session user", async () => {
    setSessionUser(user);
    const onboarded = { ...user, onboarded_at: "2026-10-13T00:00:00Z" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ organization: { id: "o2", slug: "beta", name: "Beta" } }))
      .mockResolvedValueOnce(json({ user: onboarded }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(workspaceKeys.list(), [{ id: "w1" }]);
    qc.setQueryData(["organizations"], [{ id: "o1" }]);
    const { result } = renderHook(() => useAcceptInvite(), { wrapper: wrapperFor(qc) });
    const resolve = [{ organization_id: "o1", action: "leave" as const }];
    await act(() => result.current.mutateAsync({ token: "t1", resolve }));
    expect(qc.getQueryData(workspaceKeys.list())).toBeUndefined();
    expect(qc.getQueryData(["organizations"])).toBeUndefined();
    expect(useAuthStore.getState().user?.onboarded_at).toBe("2026-10-13T00:00:00Z");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/invitations/t1/accept");
    expect(JSON.parse(String(init!.body))).toEqual({ resolve });
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/me");
  });

  it("useAcceptInvite keeps the cache when the server refuses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: { code: "organization_switch_required", message: "x", fields: { conflicts: [] } } }, 409),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(workspaceKeys.list(), [{ id: "w1" }]);
    const { result } = renderHook(() => useAcceptInvite(), { wrapper: wrapperFor(qc) });
    await expect(act(() => result.current.mutateAsync({ token: "t1" }))).rejects.toMatchObject({
      code: "organization_switch_required",
    });
    expect(qc.getQueryData(workspaceKeys.list())).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
