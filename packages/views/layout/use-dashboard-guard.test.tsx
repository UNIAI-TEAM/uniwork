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
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
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

  it("keeps the query of the link in the return path, so a comment deep link survives sign-in", async () => {
    requestMock.mockRejectedValue(new Error("401"));
    const adapter = nav("/acme/team/documents/d1");
    adapter.searchParams = new URLSearchParams("comment=c1");
    renderGuard(adapter);
    await waitFor(() =>
      expect(adapter.replace).toHaveBeenCalledWith("/login?next=%2Facme%2Fteam%2Fdocuments%2Fd1%3Fcomment%3Dc1"),
    );
  });

  // R10 F3: the login page says "session ended" only for a browser that held a session.
  it("marks the login redirect as an ended session when this browser held one", async () => {
    localStorage.setItem("uniwork_session_hint", "1");
    try {
      requestMock.mockRejectedValue(new Error("401")); // the refresh is refused → anon
      const adapter = nav("/acme/team/documents/d1");
      adapter.searchParams = new URLSearchParams("comment=c1");
      renderGuard(adapter);
      await waitFor(() =>
        expect(adapter.replace).toHaveBeenCalledWith(
          "/login?next=%2Facme%2Fteam%2Fdocuments%2Fd1%3Fcomment%3Dc1&reason=session_expired",
        ),
      );
    } finally {
      localStorage.removeItem("uniwork_session_hint");
    }
  });

  it("sends a signed-in but unverified user to verify, even when onboarded", async () => {
    useAuthStore.getState().setUser({ ...user, email_verified_at: null });
    requestMock.mockResolvedValue({ workspace });
    const adapter = nav();
    renderGuard(adapter);
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/verify"));
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

  it("moves an old slug to the workspace's current slug, keeping the path and the query", async () => {
    useAuthStore.getState().setUser(user);
    requestMock.mockResolvedValue({
      workspace: { id: "ws1", slug: "team-new", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" },
    });
    const adapter = nav("/acme/team/tasks/01J8TASK");
    adapter.searchParams = new URLSearchParams("view=board");
    renderGuard(adapter);
    await waitFor(() => expect(adapter.replace).toHaveBeenCalledWith("/acme/team-new/tasks/01J8TASK?view=board"));
  });

  it("leaves the URL alone when the slug is current", async () => {
    useAuthStore.getState().setUser(user);
    requestMock.mockResolvedValue({
      workspace: { id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" },
    });
    const adapter = nav("/acme/team/tasks");
    const { result } = renderGuard(adapter);
    await waitFor(() => expect(result.current.workspace?.id).toBe("ws1"));
    expect(adapter.replace).not.toHaveBeenCalled();
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

  it("remembers the workspace once the user is inside it", async () => {
    localStorage.clear();
    useAuthStore.getState().setUser(user);
    requestMock.mockResolvedValue({ workspace });
    const { result } = renderGuard(nav());
    await waitFor(() => expect(result.current.workspace?.id).toBe("ws1"));
    expect(JSON.parse(localStorage.getItem("uniwork_last_workspace:u1") ?? "null")).toEqual({
      orgSlug: "acme",
      wsSlug: "team",
    });
  });
});
