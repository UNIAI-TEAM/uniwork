import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, useAuthStore } from "@uniwork/core/auth";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import type { User, Workspace } from "@uniwork/core/types";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AppSidebar } from "./app-sidebar";
import { WorkspaceProvider } from "./workspace-context";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  avatar_url: "/uploads/avatars/an.png",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
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
  it("shows the current account avatar instead of an initials-only dummy", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.getByRole("img", { name: "An" })).toHaveAttribute(
      "src",
      "/uploads/avatars/an.png",
    );
  });

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

  it("groups the sections by what they are for, under visible labels", () => {
    renderSidebar("/acme/team/tasks");
    const groupOf = (label: string) => screen.getByText(label).closest<HTMLElement>('[data-slot="sidebar-group"]')!;
    const work = within(groupOf("Làm việc"));
    expect(work.getAllByRole("link").map((l) => l.textContent)).toEqual(["Công việc", "Việc của tôi", "Dự án"]);
    const communication = within(groupOf("Trao đổi"));
    expect(communication.getAllByRole("link").map((l) => l.textContent)).toEqual(["Cuộc họp", "Trò chuyện", "Danh bạ"]);
    // Still one landmark: the labels group rows, they do not split the nav.
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("names each grouped list by its visible label", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.getByRole("list", { name: "Làm việc" })).toContainElement(screen.getByRole("link", { name: "Dự án" }));
    expect(screen.getByRole("list", { name: "Trao đổi" })).toContainElement(screen.getByRole("link", { name: "Danh bạ" }));
  });

  it("keeps group headings in the locale's own casing, including English", async () => {
    await setLocale("en");
    try {
      renderSidebar("/acme/team/tasks");
      expect(screen.getByText("Work")).not.toHaveClass("uppercase");
      expect(screen.getByText("Communication")).not.toHaveClass("uppercase");
      expect(screen.getByRole("list", { name: "Work" })).toBeInTheDocument();
      expect(screen.queryByText(/nav\.group_/i)).toBeNull();
    } finally {
      await setLocale("vi");
    }
  });

  it("keeps non-menu controls on the sidebar plane without removing keyboard focus", () => {
    renderSidebar("/acme/team/tasks");
    const search = screen.getByRole("button", { name: /tìm kiếm/i });
    const workspaceButton = screen.getByRole("button", { name: /chuyển workspace/i });
    const accountButton = screen.getByRole("button", { name: /tài khoản$/ });

    for (const button of [search, workspaceButton, accountButton]) {
      expect(button).not.toHaveClass("ring-1");
      expect(button).not.toHaveClass("rounded-xl");
      expect(button.className).not.toMatch(/(?:^|\s)bg-surface(?:\/|\s)/);
      expect(button.className).toContain("focus-visible:ring-2");
    }
    expect(search.querySelector("kbd")).not.toHaveClass("ring-1");
    expect(search.querySelector("kbd")?.className).not.toContain("bg-muted");
    expect(workspaceButton.parentElement).not.toHaveClass("ring-1");
    expect(accountButton.parentElement).not.toHaveClass("ring-1");
  });

  it("starts the switcher's and the account's names with the text they show", () => {
    renderSidebar("/acme/team/tasks");
    // WCAG 2.5.3: a voice-control user says what they see.
    expect(screen.getByRole("button", { name: "Acme, Team: chuyển workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "An, a@b.c: tài khoản" })).toBeInTheDocument();
  });

  it("says in the switcher's name when another workspace has unread notifications", async () => {
    const other: Workspace = { ...workspace, id: "ws2", slug: "ops", name: "Ops" };
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/me/notifications/unread-count"
          ? { total: 3, by_workspace: { ws2: 3 } }
          : { workspaces: [workspace, other] },
      ),
    );
    renderSidebar("/acme/team/tasks");
    expect(
      await screen.findByRole("button", {
        name: "Acme, Team: chuyển workspace. Có thông báo chưa đọc ở workspace khác",
      }),
    ).toBeInTheDocument();
  });

  it("uses Multica's compact active fill without a leading brand stripe", () => {
    renderSidebar("/acme/team/meetings");
    const active = screen.getByRole("link", { name: "Cuộc họp" });
    expect(active).toHaveClass("rounded-md", "data-active:bg-sidebar-accent");
    expect(active).not.toHaveClass("rounded-xl", "data-active:bg-transparent");
    expect(document.querySelector('[data-slot="sidebar-active-island"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Công việc" })).not.toHaveAttribute("aria-current", "page");
  });

  it("names the navigation landmark so a screen reader can jump to it", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.getByRole("navigation", { name: "Điều hướng workspace" })).toBeInTheDocument();
  });

  it("places the search trigger in the sidebar chrome", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.getByRole("button", { name: /tìm kiếm/i })).toBeInTheDocument();
  });

  it("keeps log out behind the account menu rather than one click away in the chrome", async () => {
    const nav = renderSidebar("/acme/team/tasks");
    expect(screen.queryByRole("menuitem", { name: "Đăng xuất" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /tài khoản$/ }));
    const settings = await screen.findByRole("menuitem", { name: "Cài đặt" });
    expect(settings).toHaveAttribute("href", "/acme/team/settings");
    const logout = await screen.findByRole("menuitem", { name: "Đăng xuất" });
    fireEvent.click(logout);

    await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(useAuthStore.getState().status).toBe("anon");
  });

  it("always shows tasks, my-tasks and projects in the workspace nav", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.getByRole("link", { name: "Công việc" })).toHaveAttribute(
      "href",
      "/acme/team/tasks",
    );
    expect(screen.getByRole("link", { name: "Việc của tôi" })).toHaveAttribute(
      "href",
      "/acme/team/my-tasks",
    );
    expect(screen.getByRole("link", { name: "Dự án" })).toHaveAttribute(
      "href",
      "/acme/team/projects",
    );
    expect(screen.getByRole("link", { name: "Cuộc họp" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trò chuyện" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Thành viên" })).toBeNull();
  });

  it("never shows squads or runtimes in the workspace nav", () => {
    renderSidebar("/acme/team/tasks");
    expect(screen.queryByRole("link", { name: "Squad" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Runtime" })).toBeNull();
  });

  it("keeps icon controls visible when collapsed to the icon rail", () => {
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <SidebarProvider defaultOpen={false}>
            <AppSidebar />
          </SidebarProvider>
        </WorkspaceProvider>,
      ),
    );
    expect(screen.getByRole("button", { name: /tìm kiếm/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Công việc" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cuộc họp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tài khoản$/ })).toBeInTheDocument();
  });
});

describe("AppSidebar › home", () => {
  function renderWithHome(pathname: string, on: boolean) {
    const nav = {
      push: vi.fn(), replace: vi.fn(), back: vi.fn(),
      pathname, searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p,
    };
    const service = new FeatureFlagService(new StaticProvider({ home_page: { default: on } }));
    render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <SidebarProvider>
              <AppSidebar />
            </SidebarProvider>
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
        nav,
      ),
    );
  }

  it("puts Home first when home_page is on, current only on the workspace root", () => {
    renderWithHome("/acme/team", true);
    const links = screen.getAllByRole("link");
    const home = screen.getByRole("link", { name: "Trang chủ" });
    expect(home).toHaveAttribute("href", "/acme/team");
    expect(home).toHaveAttribute("aria-current", "page");
    expect(links.indexOf(home)).toBeLessThan(links.indexOf(screen.getByRole("link", { name: "Hộp việc" })));
    expect(screen.getByRole("link", { name: "Công việc" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark Home current on a page under the workspace root", () => {
    renderWithHome("/acme/team/tasks", true);
    expect(screen.getByRole("link", { name: "Trang chủ" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Công việc" })).toHaveAttribute("aria-current", "page");
  });

  it("has no Home while home_page is off", () => {
    renderWithHome("/acme/team/tasks", false);
    expect(screen.queryByRole("link", { name: "Trang chủ" })).toBeNull();
  });
});
