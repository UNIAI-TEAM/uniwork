import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ApiError } from "@uniwork/core/api";
import { ChatTaskPeekDialog } from "./chat-task-peek-dialog";

const taskState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));

vi.mock("@uniwork/core/tasks", () => ({
  useTask: () => ({ refetch: taskState.refetch, isFetching: false, ...taskState.current }),
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useProjects: () => ({ data: { projects: [] } }),
}));

vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@uniwork/core/agents", () => ({
  useWorkspaceAgents: () => ({ data: [], isLoading: false, isError: false }),
}));

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const peek = <ChatTaskPeekDialog open onOpenChange={vi.fn()} workspaceId="ws1" taskId="t1" />;

describe("ChatTaskPeekDialog", () => {
  beforeEach(() => taskState.refetch.mockReset());

  it("shows a field-shaped skeleton while loading", () => {
    taskState.current = { data: undefined, isLoading: true, isError: false };
    wrap(peek);
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải việc…");
    expect(screen.queryByText("Không tìm thấy công việc")).toBeNull();
  });

  it("says not found only for a 404", () => {
    taskState.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("gone", "not_found", 404),
    };
    wrap(peek);
    expect(screen.getByText("Không tìm thấy công việc")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers a retry when the load fails for another reason", () => {
    taskState.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new TypeError("Failed to fetch"),
    };
    wrap(peek);
    expect(screen.queryByText("Không tìm thấy công việc")).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(taskState.refetch).toHaveBeenCalled();
  });

  it("renders the editable task", () => {
    taskState.current = {
      data: {
        id: "t1",
        identifier: "LUN-2",
        title: "long ơi",
        description: "Từ chat",
        status: "todo",
        priority: "medium",
        assignee_id: null,
        assignee_kind: "human",
        due_date: null,
        project_id: null,
      },
      isLoading: false,
      isError: false,
    };
    wrap(peek);
    expect(screen.getByRole("heading", { name: "LUN-2" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tiêu đề")).toHaveValue("long ơi");
    expect(screen.getByRole("button", { name: "Trạng thái: Cần làm" })).toBeInTheDocument();
  });
});
