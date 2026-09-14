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
    const list = await screen.findByRole("list", { name: "Hộp việc" });
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

  it("moves focus between real rows with j/k, archives with e and toggles read with r", async () => {
    mockApi([row("n1"), row("n2")], { total: 2, by_workspace: { ws1: 2 } });
    renderInbox();
    const first = await screen.findByRole("link", { name: /Việc n1/ });
    const second = screen.getByRole("link", { name: /Việc n2/ });
    // The keys act on whichever row holds focus: no separate selection state,
    // so Tab, mouse and j/k all agree on what "current" is.
    first.focus();
    fireEvent.keyDown(first, { key: "j" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "j" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "k" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "r" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/read", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
    fireEvent.keyDown(first, { key: "e" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/archive", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
    // Focus moved on to the next row before the archive settled.
    expect(document.activeElement).toBe(second);
  });

  it("exposes the row actions to the keyboard, not only to hover", async () => {
    mockApi([row("n1")], { total: 1, by_workspace: { ws1: 1 } });
    renderInbox();
    await screen.findByRole("link", { name: /Việc n1/ });
    const list = screen.getByRole("list", { name: "Hộp việc" });
    // Plain list semantics: a link and two buttons per row, all in the tab order.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(within(list).getByRole("button", { name: "Đánh dấu đã đọc" })).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/archive", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
  });
});
