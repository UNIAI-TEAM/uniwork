import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { requestMock, wrap } from "../test/api-mock";
import { TaskSearchSelectCard } from "./task-search-select-card";

const taskRow = (id: string, identifier: string, title: string, status = "todo") => ({
  task: {
    id,
    workspace_id: "ws1",
    identifier,
    title,
    description: "",
    created_by: "u1",
    status,
    priority: "medium",
    position: 1,
    revision: 1,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  direct_child_count: 0,
  labels: [],
});

const baseCopy = {
  listLabel: "Danh sách việc",
  searchPlaceholder: "Tìm theo tên hoặc mã việc...",
  searchLabel: "Tìm việc",
  loadingLabel: "Đang tải...",
  loadErrorLabel: "Không tải được danh sách việc.",
  retryLabel: "Thử lại",
  emptySearchLabel: "Không tìm thấy việc phù hợp.",
  emptyWorkspaceLabel: "Không gian làm việc chưa có việc nào.",
  selectedOptionLabel: (title: string) => `${title}, đã chọn`,
  disabledOptionLabel: (title: string) => `${title}, đã gắn`,
  disabledBadgeLabel: "Đã gắn",
  resultsCappedLabel: (count: number) => `Đang hiện ${count} việc đầu.`,
};

describe("TaskSearchSelectCard", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("renders load error alert and refetches on retry", async () => {
    let failQuery = true;
    requestMock.mockImplementation((path: string) => {
      if (!path.endsWith("/tasks/table/rows")) return Promise.resolve({});
      if (failQuery) {
        return Promise.reject(new ApiError("boom", "internal", 500));
      }
      return Promise.resolve({
        query_fingerprint: "fp1",
        group_key: null,
        parent_id: null,
        total: 1,
        rows: [taskRow("t1", "UNI-1", "Việc một")],
        next_cursor: null,
      });
    });

    render(
      wrap(
        <TaskSearchSelectCard
          workspaceId="ws1"
          enabled
          query=""
          onQueryChange={vi.fn()}
          selectedId=""
          onSelectTask={vi.fn()}
          copy={baseCopy}
        />,
      ),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Không tải được danh sách việc.");
    failQuery = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByRole("option", { name: "Việc một" })).toBeInTheDocument();
  });

  it("disables tasks in disabledTaskIds, renders disabled badge/aria-label, and only invokes onSelectTask for selectable rows", async () => {
    requestMock.mockImplementation((path: string) => {
      if (!path.endsWith("/tasks/table/rows")) return Promise.resolve({});
      return Promise.resolve({
        query_fingerprint: "fp1",
        group_key: null,
        parent_id: null,
        total: 50,
        rows: [
          taskRow("t1", "UNI-1", "Việc đã gắn", "in_progress"),
          taskRow("t2", "UNI-2", "Việc chưa gắn", "done"),
        ],
        next_cursor: null,
      });
    });

    const onSelectTask = vi.fn();
    const alreadyLinked = [{ task_id: "t1" }];
    render(
      wrap(
        <TaskSearchSelectCard
          workspaceId="ws1"
          enabled
          query=""
          onQueryChange={vi.fn()}
          selectedId="t2"
          disabledTaskIds={new Set(alreadyLinked.map((item) => item.task_id))}
          onSelectTask={onSelectTask}
          copy={baseCopy}
        />,
      ),
    );

    const disabledOpt = await screen.findByRole("option", { name: "Việc đã gắn, đã gắn" });
    expect(disabledOpt).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Đã gắn")).toBeInTheDocument();
    expect(screen.getByText("Đang hiện 40 việc đầu.")).toBeInTheDocument();

    fireEvent.click(disabledOpt);
    expect(onSelectTask).not.toHaveBeenCalled();

    const selectedOpt = screen.getByRole("option", { name: "Việc chưa gắn, đã chọn" });
    expect(selectedOpt).toHaveAttribute("data-checked", "true");
    fireEvent.click(selectedOpt);
    await waitFor(() =>
      expect(onSelectTask).toHaveBeenCalledWith({ id: "t2", title: "Việc chưa gắn" }),
    );
  });
});
