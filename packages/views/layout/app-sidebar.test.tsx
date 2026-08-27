import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AppSidebar } from "./app-sidebar";
import { WorkspaceProvider } from "./workspace-context";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {},
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1",
  organization_slug: "acme", organization_name: "Acme",
};

function renderSidebar(pathname: string) {
  const nav = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(),
    pathname, searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p,
  };
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </WorkspaceProvider>,
      nav,
    ),
  );
  return nav;
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ workspaces: [workspace] });
  resetAuthStoreForTests();
  useAuthStore.getState().setUser(user);
});

describe("AppSidebar", () => {
  it("renders the workspace sections as real links that navigate through the adapter", () => {
    const nav = renderSidebar("/acme/team/meetings");
    const tasks = screen.getByRole("link", { name: "Công việc" });
    expect(tasks).toHaveAttribute("href", "/acme/team/tasks");
    fireEvent.click(tasks);
    expect(nav.push).toHaveBeenCalledWith("/acme/team/tasks");
  });

  it("marks the current section, and only it, as the current page", () => {
    renderSidebar("/acme/team/meetings");
    expect(screen.getByRole("link", { name: "Cuộc họp" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Công việc" })).not.toHaveAttribute("aria-current");
  });

  it("names the navigation landmark so a screen reader can jump to it", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.getByRole("navigation", { name: "Điều hướng workspace" })).toBeInTheDocument();
  });

  it("keeps log out behind the account menu rather than one click away in the chrome", async () => {
    const nav = renderSidebar("/acme/team/tasks");
    expect(screen.queryByRole("menuitem", { name: "Đăng xuất" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tài khoản" }));
    const settings = await screen.findByRole("menuitem", { name: "Cài đặt" });
    expect(settings).toHaveAttribute("href", "/acme/team/settings");
    const logout = await screen.findByRole("menuitem", { name: "Đăng xuất" });
    fireEvent.click(logout);

    await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(useAuthStore.getState().status).toBe("anon");
  });

  it("shows only tasks and meetings in the workspace nav", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.getByRole("link", { name: "Công việc" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cuộc họp" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Thành viên" })).toBeNull();
  });
});
