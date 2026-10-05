import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { resetAuthStoreForTests, useAuthStore } from "@uniwork/core/auth";
import type { User, Workspace } from "@uniwork/core/types";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AppSidebar } from "./app-sidebar";
import { WorkspaceProvider } from "./workspace-context";

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", avatar_url: "",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1",
  organization_slug: "acme", organization_name: "Acme",
};

const stamp = "2026-09-29T00:00:00Z";
const pin = (id: string, itemType: string, itemId: string, position: number) => ({
  id, organization_id: "o1", workspace_id: "ws1", user_id: "u1",
  item_type: itemType, item_id: itemId, position, created_at: stamp, updated_at: stamp,
});
const task = {
  id: "t1", workspace_id: "ws1", title: "Viết báo cáo", description: "", status: "in_progress",
  priority: "medium", position: 1, created_by: "u1", created_at: stamp, updated_at: stamp,
};
const project = {
  id: "p1", organization_id: "o1", workspace_id: "ws1", title: "Ra mắt", description: "",
  status: "active", priority: "none", revision: 1, task_count: 0, done_count: 0, resource_count: 0,
  created_at: stamp, updated_at: stamp,
};

type Route = (path: string, method: string) => unknown;

function serve(pins: unknown[], extra: Route = () => undefined) {
  const writes: Array<{ path: string; method: string }> = [];
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") writes.push({ path, method });
    const override = extra(path, method);
    if (override instanceof Error) return Promise.reject(override);
    if (override !== undefined) return Promise.resolve(override);
    if (path.startsWith("/api/v1/workspaces/ws1/pins") && method === "GET") {
      return Promise.resolve({ pins, total: pins.length });
    }
    if (path === "/api/v1/tasks/t1") return Promise.resolve({ task });
    if (path === "/api/v1/workspaces/ws1/projects/p1") return Promise.resolve({ project });
    if (method === "DELETE") return Promise.resolve(undefined);
    return Promise.resolve({ workspaces: [workspace] });
  });
  return writes;
}

function renderSidebar(pathname = "/acme/team/meetings") {
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

const pinnedList = () => screen.findByRole("list", { name: "Đã ghim" });

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  useAuthStore.getState().setUser(user);
});

describe("AppSidebar pinned items", () => {
  it("shows no pinned group while nothing is pinned", async () => {
    serve([]);
    renderSidebar();
    await screen.findByRole("link", { name: "Công việc" });
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/pins"));
    expect(screen.queryByRole("list", { name: "Đã ghim" })).toBeNull();
  });

  it("lists pinned tasks and projects by name, in the server's order, as links to their pages", async () => {
    serve([pin("a", "project", "p1", 1), pin("b", "task", "t1", 2)]);
    renderSidebar();
    const list = await pinnedList();
    const projectLink = await within(list).findByRole("link", { name: "Ra mắt" });
    const taskLink = await within(list).findByRole("link", { name: "Viết báo cáo" });
    expect(within(list).getAllByRole("link")).toEqual([projectLink, taskLink]);
    expect(within(list).getByRole("link", { name: "Viết báo cáo" })).toHaveAttribute("href", "/acme/team/tasks/t1");
    expect(within(list).getByRole("link", { name: "Ra mắt" })).toHaveAttribute("href", "/acme/team/projects/p1");
  });

  it("unpins from the row at once, before the server answers", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    });
    const writes = serve([pin("b", "task", "t1", 1)], (_path, method) => (method === "DELETE" ? held : undefined));
    renderSidebar();
    const list = await pinnedList();
    fireEvent.click(await within(list).findByRole("button", { name: "Bỏ ghim Viết báo cáo" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Viết báo cáo" })).toBeNull());
    expect(writes).toContainEqual({ path: "/api/v1/workspaces/ws1/pins/task/t1", method: "DELETE" });
    release();
  });

  it("drops the pin of an item that no longer exists", async () => {
    const writes = serve([pin("b", "task", "t1", 1), pin("a", "project", "p1", 2)], (path) =>
      path === "/api/v1/tasks/t1" ? new ApiError("gone", "not_found", 404) : undefined,
    );
    renderSidebar();
    const list = await pinnedList();
    await within(list).findByRole("link", { name: "Ra mắt" });
    await waitFor(() =>
      expect(writes).toContainEqual({ path: "/api/v1/workspaces/ws1/pins/task/t1", method: "DELETE" }),
    );
  });

  it("marks the open pinned page as current instead of its section", async () => {
    serve([pin("b", "task", "t1", 1)]);
    renderSidebar("/acme/team/tasks/t1");
    const list = await pinnedList();
    expect(await within(list).findByRole("link", { name: "Viết báo cáo" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Công việc" })).not.toHaveAttribute("aria-current");
  });

  it("collapses the group from its heading", async () => {
    serve([pin("b", "task", "t1", 1)]);
    renderSidebar();
    await pinnedList();
    const toggle = screen.getByRole("button", { name: "Đã ghim" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
  });

  it("keeps the pins one click away in the icon rail, behind a counted menu", async () => {
    serve([pin("a", "project", "p1", 1), pin("b", "task", "t1", 2)]);
    const nav = renderSidebar();
    await pinnedList();
    fireEvent.click(screen.getByRole("button", { name: "Đã ghim: 2 mục" }));
    const project = await screen.findByRole("menuitem", { name: "Ra mắt" });
    const task = await screen.findByRole("menuitem", { name: "Viết báo cáo" });
    expect(screen.getAllByRole("menuitem")).toEqual([project, task]);
    expect(task).toHaveAttribute("href", "/acme/team/tasks/t1");
    fireEvent.click(task);
    expect(nav.push).toHaveBeenCalledWith("/acme/team/tasks/t1");
  });
});
