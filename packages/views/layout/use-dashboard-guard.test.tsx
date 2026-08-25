import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, useAuthStore } from "@uniwork/core/auth";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { NavigationProvider } from "../navigation";
import type { NavigationAdapter } from "../navigation";
import { useDashboardGuard } from "./use-dashboard-guard";

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {},
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team",
  organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

function nav(pathname = "/acme/team/tasks") {
  const adapter: NavigationAdapter = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(),
    pathname, searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
  return adapter;
}

function renderGuard(adapter: NavigationAdapter) {
  return renderHook(() => useDashboardGuard("acme", "team"), {
    wrapper: ({ children }) => wrap(<NavigationProvider value={adapter}>{children}</NavigationProvider>),
  });
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("useDashboardGuard", () => {
  it("sends an anonymous visitor to login with a return path", async () => {
    requestMock.mockRejectedValue(new Error("401")); // refresh fails → anon
    const adapter = nav("/acme/team/tasks");
    renderGuard(adapter);
    await waitFor(() =>
      expect(adapter.replace).toHaveBeenCalledWith("/login?next=%2Facme%2Fteam%2Ftasks"),
    );
  });

  it("sends a signed-in but not-onboarded user to onboarding", async () => {
    useAuthStore.getState().setUser({ ...user, onboarded_at: null });
    requestMock.mockResolvedValue({ workspace });
    const adapter = nav();
    renderGuard(adapter);
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("sends a user whose URL does not resolve to a workspace to the picker", async () => {
    useAuthStore.getState().setUser(user);
    requestMock.mockRejectedValue(new Error("404"));
    const adapter = nav();
    renderGuard(adapter);
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/workspaces"));
  });

  it("returns the user and workspace when every gate passes, and never redirects", async () => {
    useAuthStore.getState().setUser(user);
    requestMock.mockResolvedValue({ workspace });
    const adapter = nav();
    const { result } = renderGuard(adapter);
    await waitFor(() => expect(result.current.workspace?.id).toBe("ws1"));
    expect(result.current.user?.id).toBe("u1");
    expect(adapter.replace).not.toHaveBeenCalled();
  });
});
