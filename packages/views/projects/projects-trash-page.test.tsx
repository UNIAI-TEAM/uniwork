import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrap } from "../test/api-mock";
import { ProjectsTrashPage } from "./projects-trash-page";

initI18n();

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const project = {
  id: "p1",
  title: "Dự án Tết",
  trashed_at: "2026-10-20T08:00:00Z",
  trashed_by: "u2",
  purge_after: "2099-01-01T00:00:00Z",
  task_count: 4,
};

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/members")) {
      return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u2", email: "lan@x.com", display_name: "Lan", role: "member" }] });
    }
    if (p.endsWith("/projects/trash")) return Promise.resolve({ items: [project], next_cursor: "" });
    if (init?.method === "POST") return Promise.resolve({});
    return Promise.resolve({});
  });
});

describe("ProjectsTrashPage", () => {
  it("lists the trashed project with its task count", async () => {
    render(wrap(<ProjectsTrashPage workspaceId="w1" />));
    expect(await screen.findByText("Dự án Tết")).toBeInTheDocument();
    expect(screen.getByText("4 công việc trong dự án")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Xóa bởi Lan lúc/)).toBeInTheDocument());
  });

  it("restores through the project route", async () => {
    render(wrap(<ProjectsTrashPage workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Khôi phục Dự án Tết" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã khôi phục"));
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/w1/projects/p1/restore",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("explains a title clash on restore", async () => {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      const p = String(path);
      if (init?.method === "POST") return Promise.reject(new ApiError("x", "duplicate_project_title", 409));
      if (p.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({ items: [project], next_cursor: "" });
    });
    render(wrap(<ProjectsTrashPage workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Khôi phục Dự án Tết" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Đã có dự án trùng tên")),
    );
  });

  it("asks before purging and says it cannot be undone", async () => {
    render(wrap(<ProjectsTrashPage workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa vĩnh viễn Dự án Tết" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/Không hoàn tác được/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa vĩnh viễn" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/w1/projects/p1/purge",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
