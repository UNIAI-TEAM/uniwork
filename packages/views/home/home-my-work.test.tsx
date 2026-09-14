import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import type { HomeSummary } from "@uniwork/core/types/home";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { HomeMyWork } from "./home-my-work";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const task = (id: string, title: string, due?: string) =>
  ({
    id, workspace_id: "ws1", title, description: "", status: "todo", priority: "urgent", position: 1, created_by: "u1",
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", identifier: `ALP-${id}`, due_date: due,
  }) as HomeSummary["my_work"][number];

const summary: HomeSummary = {
  today: "2026-09-14",
  timezone: "Asia/Ho_Chi_Minh",
  counts: { open: 2, overdue: 1, due_today: 1, meetings_today: 0, unread: 0 },
  my_work: [task("1", "Viết spec", "2026-09-10"), task("2", "Chuẩn bị demo", "2026-09-14")],
  upcoming_meetings: [],
  inbox: [],
  partial: [],
  generated_at: "",
};

function renderMyWork() {
  const nav = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(),
    pathname: "/acme/team", searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p,
  };
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <HomeMyWork summary={summary} loading={false} retrying={false} onRetry={() => {}} />
      </WorkspaceProvider>,
      nav,
    ),
  );
  return nav;
}

const calls = () => requestMock.mock.calls.map(([path, opts]) => [path, opts] as [string, { method?: string; body?: unknown }]);

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ task: task("1", "Viết spec") });
});

describe("HomeMyWork", () => {
  it("shows each task with its identifier, due state and priority", () => {
    renderMyWork();
    expect(screen.getByRole("link", { name: /Viết spec/ })).toHaveAttribute("href", "/acme/team/tasks/1");
    expect(screen.getByText("ALP-1")).toBeInTheDocument();
    expect(screen.getByText("Quá hạn 4 ngày")).toBeInTheDocument();
    expect(screen.getByText("Hạn hôm nay")).toBeInTheDocument();
    expect(screen.getAllByText("Khẩn cấp")).toHaveLength(2);
  });

  it("completes one task through PATCH status done", async () => {
    renderMyWork();
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành: Viết spec" }));
    await waitFor(() =>
      expect(calls()).toContainEqual(["/api/v1/tasks/1", expect.objectContaining({ method: "PATCH", body: { status: "done" } })]),
    );
  });

  it("completes the selected tasks in one batch update", async () => {
    requestMock.mockResolvedValue({ updated: 2 });
    renderMyWork();
    fireEvent.click(screen.getByRole("checkbox", { name: "Chọn: Viết spec" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Chọn: Chuẩn bị demo" }));
    expect(screen.getByText("Đã chọn 2/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành 2 việc" }));
    await waitFor(() =>
      expect(calls()).toContainEqual([
        "/api/v1/workspaces/ws1/tasks/batch-update",
        expect.objectContaining({ method: "POST", body: { task_ids: ["1", "2"], updates: { status: "done" } } }),
      ]),
    );
  });

  it("keeps the list plain so each row control keeps its role", () => {
    renderMyWork();
    const list = screen.getByRole("list", { name: "Công việc của tôi" });
    expect(list).not.toHaveAttribute("role");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("moves real focus between rows and selects, completes and opens from the keyboard", async () => {
    const nav = renderMyWork();
    const first = screen.getByRole("link", { name: /Viết spec/ });
    const second = screen.getByRole("link", { name: /Chuẩn bị demo/ });
    first.focus();
    fireEvent.keyDown(first, { key: "j" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "x" });
    expect(screen.getByRole("checkbox", { name: "Chọn: Chuẩn bị demo" })).toBeChecked();
    fireEvent.keyDown(second, { key: "k" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "c" });
    await waitFor(() =>
      expect(calls()).toContainEqual(["/api/v1/tasks/1", expect.objectContaining({ method: "PATCH", body: { status: "done" } })]),
    );
    fireEvent.keyDown(first, { key: "o" });
    expect(nav.push).toHaveBeenCalledWith("/acme/team/tasks/1");
  });

});
