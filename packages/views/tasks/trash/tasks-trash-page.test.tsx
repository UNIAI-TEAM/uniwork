import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrap } from "../../test/api-mock";
import { TasksTrashPage } from "./tasks-trash-page";

initI18n();

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const row = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  identifier: "UW-7",
  title: "Soạn hợp đồng",
  trashed_at: "2026-10-20T08:00:00Z",
  trashed_by: "u2",
  purge_after: "2099-01-01T00:00:00Z",
  batch_size: 3,
  ...over,
});

let pages: Array<{ items: unknown[]; next_cursor: string }>;

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
  requestMock.mockReset();
  pages = [{ items: [row()], next_cursor: "" }];
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/members")) {
      return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u2", email: "lan@x.com", display_name: "Lan", role: "member" }] });
    }
    if (p.includes("/tasks/trash")) {
      return Promise.resolve(p.includes("cursor=c2") ? pages[1] : pages[0]);
    }
    if (init?.method === "POST") return Promise.resolve({ trash_batch_id: "b1", ids: ["t1", "t2", "t3"] });
    return Promise.resolve({});
  });
});

const posts = () =>
  requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST");

describe("TasksTrashPage", () => {
  it("lists the trashed task with the member's name and its subtask count", async () => {
    render(wrap(<TasksTrashPage workspaceId="w1" />));
    expect(await screen.findByText("Soạn hợp đồng")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Thùng rác" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Xóa bởi Lan lúc/)).toBeInTheDocument());
    expect(screen.getByText("Gồm 2 task con")).toBeInTheDocument();
  });

  it("falls back to a neutral label when the member is unknown", async () => {
    pages = [{ items: [row({ trashed_by: "ghost" })], next_cursor: "" }];
    render(wrap(<TasksTrashPage workspaceId="w1" />));
    expect(await screen.findByText(/Xóa bởi Thành viên cũ lúc/)).toBeInTheDocument();
  });

  it("restores a row with one POST and says so", async () => {
    render(wrap(<TasksTrashPage workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Khôi phục Soạn hợp đồng" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã khôi phục"));
    expect(posts().map(([path]) => path)).toEqual(["/api/v1/tasks/t1/restore"]);
  });

  it("opens a dialog that says it cannot be undone before it purges", async () => {
    render(wrap(<TasksTrashPage workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa vĩnh viễn Soạn hợp đồng" }));
    expect(posts()).toHaveLength(0);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Không hoàn tác được/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã xóa vĩnh viễn"));
    expect(posts().map(([path]) => path)).toEqual(["/api/v1/tasks/t1/purge"]);
  });

  it("explains a restore whose task is gone", async () => {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (init?.method === "POST") return Promise.reject(new ApiError("x", "not_found", 404));
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve(pages[0]);
    });
    render(wrap(<TasksTrashPage workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Khôi phục Soạn hợp đồng" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nội dung này không còn tồn tại hoặc đã bị xóa."),
    );
  });

  it("loads the next page on demand", async () => {
    pages = [
      { items: [row()], next_cursor: "c2" },
      { items: [row({ id: "t9", title: "Việc cũ hơn" })], next_cursor: "" },
    ];
    render(wrap(<TasksTrashPage workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Tải thêm" }));
    expect(await screen.findByText("Việc cũ hơn")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm" })).not.toBeInTheDocument();
  });

  it("shows an honest empty state", async () => {
    pages = [{ items: [], next_cursor: "" }];
    render(wrap(<TasksTrashPage workspaceId="w1" />));
    expect(await screen.findByText("Thùng rác công việc trống")).toBeInTheDocument();
  });
});
