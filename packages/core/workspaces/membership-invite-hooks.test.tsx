import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { setSessionUser } from "../auth/hooks";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { User } from "../types/user";
import { workspaceKeys } from "./keys";
import { useJoinMembershipInviteLink, useMembershipInvitePreview } from "./membership-invite-hooks";

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

describe("membership invite hooks", () => {
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

  it("useMembershipInvitePreview posts link_id and secret", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        link_id: "l1",
        status: "active",
        organization: { id: "o1", slug: "acme", name: "Acme" },
        workspaces: [{ id: "w1", slug: "team", name: "Team", joined: false }],
        needs_join: true,
        already_member: false,
        conflicts: [],
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMembershipInvitePreview("l1", "sec"), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/membership-invite-links/preview");
    expect(JSON.parse(String(init!.body))).toEqual({ link_id: "l1", secret: "sec" });
  });

  it("useJoinMembershipInviteLink drops the cache, then refreshes the session user", async () => {
    setSessionUser(user);
    const onboarded = { ...user, onboarded_at: "2026-10-27T00:00:00Z" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({
          organization: { id: "o2", slug: "beta", name: "Beta" },
          workspace: {
            id: "w2",
            slug: "team",
            name: "Team",
            organization_id: "o2",
            organization_slug: "beta",
            organization_name: "Beta",
          },
          joined_ids: ["w2"],
        }),
      )
      .mockResolvedValueOnce(json({ user: onboarded }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(workspaceKeys.list(), [{ id: "w1" }]);
    const { result } = renderHook(() => useJoinMembershipInviteLink(), { wrapper: wrapperFor(qc) });
    await act(() => result.current.mutateAsync({ linkId: "l1", secret: "sec" }));
    expect(qc.getQueryData(workspaceKeys.list())).toBeUndefined();
    expect(useAuthStore.getState().user?.onboarded_at).toBe("2026-10-27T00:00:00Z");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/membership-invite-links/join",
    );
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("http://api.test/api/v1/me");
  });
});
