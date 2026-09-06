import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { InboxView } from "./inbox-view";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "task_assigned", workspace_id: "ws1", organization_id: "o1", resource_type: "task", resource_id: "t-" + id,
  resource_deleted: false, actor_kind: "human", actor_id: "u2", title_key: "notifications.kind.task_assigned",
  params: { actor: "Bình", task: "Việc " + id }, count: 1, created_at: "2026-09-06T08:00:00Z", ...extra,
});

function mockApi(notifications: unknown[], unread = { total: 0, by_workspace: {} as Record<string, number> }) {
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/me/notifications/unread-count")) return Promise.resolve(unread);
    if (path.startsWith("/api/v1/me/notifications?")) return Promise.resolve({ notifications, next_before: "" });
    return Promise.resolve({ status: "ok" });
  });
}

function renderInbox() {
  const nav = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(),
    pathname: "/acme/team/inbox", searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p,
  };
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <InboxView />
      </WorkspaceProvider>,
      nav,
    ),
  );
  return nav;
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("InboxView", () => {
  it("groups unread before earlier, renders merged counts and deleted resources", async () => {
    mockApi(
      [
        row("n1", { count: 4 }),
        row("n2", { read_at: "2026-09-06T09:00:00Z", resource_deleted: true, resource_type: "meeting", kind: "meeting_invited", title_key: "notifications.kind.meeting_invited", params: { actor: "Bình", meeting: "Họp" } }),
      ],
      { total: 1, by_workspace: { ws1: 1 } },
    );
    renderInbox();
    const list = await screen.findByRole("listbox", { name: "Hộp việc" });
    const items = within(list).getAllByRole("presentation");
    expect(items[0]).toHaveTextContent("Chưa đọc");
    expect(items[1]).toHaveTextContent("Trước đó");
    expect(screen.getByRole("link", { name: /Bình đã giao bạn việc “Việc n1”/ })).toHaveAttribute("href", "/acme/team/tasks/t-n1");
    expect(screen.getByText("và 3 thay đổi khác")).toBeInTheDocument();
    // The deleted meeting is still a row, but not a link.
    expect(screen.getByText("Bình đã mời bạn họp “Họp”")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Họp/ })).toBeNull();
    expect(screen.getByText("đã xóa")).toBeInTheDocument();
  });

  it("shows an honest empty state with a link to settings", async () => {
    mockApi([]);
    renderInbox();
    expect(await screen.findByText("Chưa có thông báo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Cài đặt thông báo/ })).toHaveAttribute("href", "/acme/team/settings?tab=notifications");
    expect(screen.getByRole("button", { name: "Đánh dấu tất cả đã đọc" })).toBeDisabled();
  });

  it("marks a row read when opened and marks everything read from the header", async () => {
    mockApi([row("n1"), row("n2")], { total: 2, by_workspace: { ws1: 2 } });
    const nav = renderInbox();
    const link = await screen.findByRole("link", { name: /Việc n1/ });
    fireEvent.click(link);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/read", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
    expect(nav.push).toHaveBeenCalledWith("/acme/team/tasks/t-n1");
    fireEvent.click(screen.getByRole("button", { name: "Đánh dấu tất cả đã đọc" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/me/notifications/read",
        expect.objectContaining({ body: { all: true, workspace_id: "ws1" } }),
      ),
    );
  });

  it("moves with j/k, archives with e and toggles read with r", async () => {
    mockApi([row("n1"), row("n2")], { total: 2, by_workspace: { ws1: 2 } });
    renderInbox();
    const list = await screen.findByRole("listbox", { name: "Hộp việc" });
    list.focus();
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "j" });
    expect(list.getAttribute("aria-activedescendant")).toBe("n2");
    fireEvent.keyDown(list, { key: "k" });
    expect(list.getAttribute("aria-activedescendant")).toBe("n1");
    fireEvent.keyDown(list, { key: "r" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/read", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
    fireEvent.keyDown(list, { key: "e" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/archive", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
    // Selection moved on to the next row before the archive settled.
    expect(list.getAttribute("aria-activedescendant")).toBe("n2");
  });
});
