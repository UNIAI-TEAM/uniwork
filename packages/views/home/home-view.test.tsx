import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { HomeView } from "./home-view";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const task = (id: string, title: string, due?: string) => ({
  id, workspace_id: "ws1", title, description: "", status: "todo", priority: "high", position: 1, created_by: "u1",
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", identifier: `ALP-${id}`, due_date: due,
});

const summary = {
  today: "2026-09-14",
  timezone: "Asia/Ho_Chi_Minh",
  counts: { open: 2, overdue: 1, due_today: 1, meetings_today: 1, unread: 1 },
  my_work: [task("1", "Viết spec", "2026-09-10"), task("2", "Chuẩn bị demo", "2026-09-14")],
  upcoming_meetings: [
    {
      id: "m1", workspace_id: "ws1", title: "Standup", description: "", starts_at: "2026-09-14T07:00:00Z",
      ends_at: "2026-09-14T07:30:00Z", room_name: "r", created_by: "u1", status: "SCHEDULED",
    },
  ],
  inbox: [
    {
      id: "n1", kind: "task_assigned", workspace_id: "ws1", resource_type: "task", resource_id: "1",
      title_key: "notifications.kind.task_assigned", params: { actor: "Bình", task: "Việc được giao" }, created_at: "2026-09-14T01:00:00Z",
    },
  ],
  partial: [],
  generated_at: "2026-09-14T03:00:00Z",
};

const empty = {
  ...summary,
  counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 },
  my_work: [],
  upcoming_meetings: [],
  inbox: [],
};

type Opts = { method?: string; body?: { prefs?: unknown } };

function serve({ home = summary as unknown, prefs = {} as Record<string, unknown> } = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, opts?: Opts) => {
    if (path.endsWith("/home/preferences")) {
      return opts?.method === "PUT" ? { prefs: opts.body?.prefs, updated_at: "t" } : { prefs, updated_at: "" };
    }
    if (path.endsWith("/home")) {
      if (home instanceof Error) throw home;
      return home;
    }
    return {};
  });
}

function renderHome() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <HomeView />
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(() => serve());

describe("HomeView", () => {
  it("renders every section from the one home request", async () => {
    renderHome();
    expect(await screen.findByText("Chuẩn bị demo")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trang chủ", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Hôm nay có 3 việc cần bạn chú ý")).toBeInTheDocument();
    expect(screen.getByTestId("home-stat-overdue")).toHaveTextContent("1");
    expect(screen.getByText("Quá hạn 4 ngày")).toBeInTheDocument();
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Hộp việc" })).toHaveTextContent("Bình đã giao bạn việc “Việc được giao”");
    expect(screen.getByText("1 việc đang quá hạn, cũ nhất là “Viết spec” (quá hạn 4 ngày).")).toBeInTheDocument();
    expect(requestMock.mock.calls.filter(([p]) => String(p).endsWith("/home"))).toHaveLength(1);
  });

  it("lands overdue and due today on the first such task, and the others on their screens", async () => {
    renderHome();
    await screen.findByText("Chuẩn bị demo");
    fireEvent.click(screen.getByRole("button", { name: "1 quá hạn" }));
    expect(screen.getByRole("link", { name: /Viết spec/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "1 đến hạn hôm nay" }));
    expect(screen.getByRole("link", { name: /Chuẩn bị demo/ })).toHaveFocus();
    expect(screen.getByRole("link", { name: "1 cuộc họp hôm nay" })).toHaveAttribute("href", "/acme/team/meetings");
    expect(screen.getByRole("link", { name: "1 chưa đọc" })).toHaveAttribute("href", "/acme/team/inbox");
  });

  it("keeps a work count as plain text when it is zero or My work is hidden", async () => {
    serve({ prefs: { enabled: { mywork: false } } });
    renderHome();
    await screen.findByText("Standup");
    await waitFor(() => expect(screen.queryByText("Chuẩn bị demo")).toBeNull());
    expect(screen.queryByRole("button", { name: "1 quá hạn" })).toBeNull();
    expect(screen.getByTestId("home-stat-overdue")).toHaveTextContent("1");
  });

  it("says what to do next when nothing is waiting, and drops the brief", async () => {
    serve({ home: empty });
    renderHome();
    expect(await screen.findByText("Không có việc cần xử lý")).toBeInTheDocument();
    expect(screen.getByText("Không có cuộc họp")).toBeInTheDocument();
    expect(screen.getByText("Hộp việc trống")).toBeInTheDocument();
    expect(screen.getByText("Hôm nay bạn không có việc gấp")).toBeInTheDocument();
    expect(screen.queryByText("Từ dữ liệu thật")).toBeNull();
    expect(screen.getByRole("link", { name: "Mở danh sách công việc" })).toHaveAttribute("href", "/acme/team/tasks");
  });

  it("shows an error with a retry that reloads the page", async () => {
    serve({ home: new Error("down") });
    renderHome();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Không tải được trang chủ")).toBeInTheDocument();
    serve();
    fireEvent.click(within(alert).getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Chuẩn bị demo")).toBeInTheDocument();
  });

  it("labels a failed source and keeps the others", async () => {
    serve({ home: { ...summary, upcoming_meetings: [], partial: ["meetings"] } });
    renderHome();
    expect(await screen.findByText("Không tải được lịch họp.")).toBeInTheDocument();
    expect(screen.getByText("Chuẩn bị demo")).toBeInTheDocument();
  });

  it("leaves a way back when every section is hidden", async () => {
    serve({ prefs: { enabled: { stats: false, mywork: false, upcoming: false, inbox: false, brief: false } } });
    renderHome();
    expect(await screen.findByText("Bạn đã ẩn mọi khối trên trang chủ.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở tuỳ chỉnh" }));
    expect(screen.getByRole("heading", { name: "Tuỳ chỉnh trang chủ" })).toBeInTheDocument();
  });

  it("saves a hidden section and removes it from the page", async () => {
    renderHome();
    expect(await screen.findByText("Từ dữ liệu thật")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tuỳ chỉnh" }));
    fireEvent.click(screen.getByRole("switch", { name: "Tóm tắt hôm nay" }));
    await waitFor(() => {
      const put = requestMock.mock.calls.find(([p, o]) => String(p).endsWith("/home/preferences") && (o as Opts)?.method === "PUT");
      expect((put?.[1] as Opts).body?.prefs).toMatchObject({ enabled: { brief: false } });
    });
    await waitFor(() => expect(screen.queryByText("Từ dữ liệu thật")).toBeNull());
  });
});
