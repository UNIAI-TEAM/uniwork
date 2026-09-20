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

function mockApi(
  notifications: unknown[],
  unread = { total: 0, by_workspace: {} as Record<string, number> },
  older: unknown[] = [],
) {
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/me/notifications/unread-count")) return Promise.resolve(unread);
    if (path.startsWith("/api/v1/me/notifications?")) {
      // A second page exists only when `older` is given; it is fetched with the cursor.
      if (path.includes("before=")) return Promise.resolve({ notifications: older, next_before: "" });
      return Promise.resolve({ notifications, next_before: older.length > 0 ? "cursor-1" : "" });
    }
    return Promise.resolve({ status: "ok" });
  });
}

// jsdom pads every element in an accessible name with spaces, where a browser
// joins inline text as it reads; the emphasised names inside a row's sentence
// are spans, so the patterns below allow that padding.
const sentence = (text: string) => new RegExp(text.replace(/[“”]/g, (q) => (q === "“" ? "“\\s?" : "\\s?”")));

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
    // Read rows are grouped by the viewer's day; 2026-09-06 is well past a week.
    expect(items[1]).toHaveTextContent("Cũ hơn");
    expect(screen.getByRole("link", { name: sentence("Bình đã giao bạn việc “Việc n1”") })).toHaveAttribute(
      "href",
      "/acme/team/tasks/t-n1",
    );
    expect(screen.getByText("và 3 thay đổi khác")).toBeInTheDocument();
    // The deleted meeting is still a row, but not a link.
    expect(list.querySelector('[data-notification-id="n2"]')).toHaveTextContent("Bình đã mời bạn họp “Họp”");
    expect(screen.queryByRole("link", { name: /Họp/ })).toBeNull();
    expect(screen.getByText("đã xóa")).toBeInTheDocument();
  });

  it("shows an honest empty state with a link to settings", async () => {
    mockApi([]);
    renderInbox();
    expect(await screen.findByText("Chưa có thông báo")).toBeInTheDocument();
    // The header's settings link and the empty state's go to the same place.
    for (const link of screen.getAllByRole("link", { name: /Cài đặt thông báo/ })) {
      expect(link).toHaveAttribute("href", "/acme/team/settings?tab=notifications");
    }
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

  it("names the status and the role in the reader's language and labels an agent as one", async () => {
    mockApi([
      row("n1", { kind: "task_status_changed", title_key: "notifications.kind.task_status_changed", params: { actor: "Bình", task: "Việc n1", status: "in_review" } }),
      row("n2", { kind: "task_commented", title_key: "notifications.kind.task_commented", actor_kind: "agent", params: { actor: "UNI", task: "Việc n2" } }),
      row("n3", { kind: "role_changed", title_key: "notifications.kind.role_changed", resource_type: "workspace", params: { actor: "Bình", role: "admin" } }),
    ]);
    renderInbox();
    const status = await screen.findByRole("link", { name: /Việc n1/ });
    expect(status).toHaveTextContent("Bình chuyển “Việc n1” sang Đang review");
    expect(status).not.toHaveTextContent("in_review");
    expect(screen.getByRole("link", { name: /Việc n2/ })).toHaveTextContent("UNI Agent đã bình luận trong “Việc n2”");
    expect(screen.getByRole("link", { name: /vai trò/ })).toHaveTextContent("Bình đã đổi vai trò của bạn thành Quản trị");
  });

  it("narrows to a category, counting unread per category only when every unread row is loaded", async () => {
    mockApi(
      [
        row("n1", { kind: "mentioned", title_key: "notifications.kind.mentioned" }),
        row("n2", { kind: "meeting_invited", resource_type: "meeting", title_key: "notifications.kind.meeting_invited", params: { actor: "Bình", meeting: "Họp tuần" } }),
      ],
      { total: 2, by_workspace: { ws1: 2 } },
    );
    renderInbox();
    await screen.findByRole("link", { name: /Họp tuần/ });
    const meetings = screen.getByRole("button", { name: /Cuộc họp/ });
    expect(within(meetings).getByLabelText("1 chưa đọc")).toBeInTheDocument();
    fireEvent.click(meetings);
    await waitFor(() => expect(screen.queryByRole("link", { name: /Việc n1/ })).toBeNull());
    expect(screen.getByRole("link", { name: /Họp tuần/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Giao cho bạn/ }));
    expect(await screen.findByText("Không có thông báo loại này")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem mọi loại" }));
    expect(await screen.findByRole("link", { name: /Việc n1/ })).toBeInTheDocument();
  });

  it("hides the per-category counts when an unread row is not loaded yet", async () => {
    mockApi([row("n1", { kind: "mentioned", title_key: "notifications.kind.mentioned" })], { total: 3, by_workspace: { ws1: 3 } });
    renderInbox();
    await screen.findByRole("link", { name: /Việc n1/ });
    expect(screen.queryByLabelText(/chưa đọc$/)).toBeNull();
  });

  it("fetches older notifications through the cursor", async () => {
    mockApi([row("n1")], { total: 1, by_workspace: { ws1: 1 } }, [row("n0", { read_at: "2026-09-01T09:00:00Z", params: { actor: "Bình", task: "Việc cũ" } })]);
    renderInbox();
    await screen.findByRole("link", { name: /Việc n1/ });
    fireEvent.click(screen.getByRole("button", { name: "Xem thông báo cũ hơn" }));
    expect(await screen.findByRole("link", { name: /Việc cũ/ })).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("before=cursor-1"));
    expect(screen.getByText("Đã hết thông báo")).toBeInTheDocument();
  });

  it("keeps a row in its group when r toggles it, so focus stays on it", async () => {
    mockApi([row("n1"), row("n2")], { total: 2, by_workspace: { ws1: 2 } });
    renderInbox();
    const first = await screen.findByRole("link", { name: /Việc n1/ });
    first.focus();
    fireEvent.keyDown(first, { key: "r" });
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/read", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
    const list = screen.getByRole("list", { name: "Hộp việc" });
    expect(within(list).getAllByRole("presentation")).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /Việc n1/ }));
  });
});
