import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { TooltipProvider } from "@uniwork/ui/components/ui/tooltip";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NotificationBell } from "./notification-bell";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const row = {
  id: "n1", kind: "task_assigned", workspace_id: "ws1", organization_id: "o1", resource_type: "task", resource_id: "t1",
  resource_deleted: false, actor_kind: "human", actor_id: "u2", title_key: "notifications.kind.task_assigned",
  params: { actor: "Bình", task: "Việc một" }, count: 1, created_at: "2026-09-06T08:00:00Z",
};

function renderBell() {
  render(
    wrapWithNav(
      <TooltipProvider>
        <WorkspaceProvider workspace={workspace} user={user}>
          <NotificationBell />
        </WorkspaceProvider>
      </TooltipProvider>,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /Thông báo/ }));
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("NotificationBell", () => {
  it("says the list failed and retries it, never that nothing is waiting", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/me/notifications/unread-count")) return Promise.resolve({ total: 1, by_workspace: { ws1: 1 } });
      if (path.startsWith("/api/v1/me/notifications?")) {
        return fail ? Promise.reject(new Error("boom")) : Promise.resolve({ notifications: [row], next_before: "" });
      }
      return Promise.resolve({ status: "ok" });
    });
    renderBell();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Không tải được hộp việc");
    expect(screen.queryByText("Chưa có thông báo")).toBeNull();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("link", { name: /Việc một/ })).toBeInTheDocument();
  });

  it("shows compact rows with no row actions", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/me/notifications/unread-count")) return Promise.resolve({ total: 1, by_workspace: { ws1: 1 } });
      if (path.startsWith("/api/v1/me/notifications?")) return Promise.resolve({ notifications: [row], next_before: "" });
      return Promise.resolve({ status: "ok" });
    });
    renderBell();
    const list = await screen.findByRole("list", { name: "Hộp việc" });
    expect(within(list).getByRole("link", { name: /Việc một/ })).toHaveAttribute("href", "/acme/team/tasks/t1");
    expect(within(list).queryByRole("button")).toBeNull();
  });
});
