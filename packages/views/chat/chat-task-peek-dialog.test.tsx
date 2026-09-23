import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ApiError } from "@uniwork/core/api";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { ChatTaskPeekDialog } from "./chat-task-peek-dialog";

const taskState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  refetch: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("@uniwork/core/tasks", () => ({
  useTask: () => ({ refetch: taskState.refetch, isFetching: false, ...taskState.current }),
  useUpdateTask: () => ({ mutate: taskState.mutate }),
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
  beforeEach(() => {
    taskState.refetch.mockReset();
    taskState.mutate.mockReset();
  });

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

  const loadedTask = {
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

  it("says a save failed in the peek itself, and says when it saved", () => {
    taskState.current = loadedTask;
    wrap(peek);
    const title = screen.getByLabelText("Tiêu đề");
    fireEvent.change(title, { target: { value: "Tiêu đề mới" } });
    fireEvent.blur(title);
    const [, options] = taskState.mutate.mock.calls[0] as [unknown, { onError: (e: unknown) => void; onSuccess: () => void }];
    act(() => options.onError(new ApiError("raw", "conflict", 409)));
    expect(screen.getByRole("alert")).toHaveTextContent("Nội dung đã thay đổi hoặc đã tồn tại. Tải lại rồi thử lại.");

    fireEvent.change(title, { target: { value: "Tiêu đề khác" } });
    fireEvent.blur(title);
    const [, again] = taskState.mutate.mock.calls[1] as [unknown, { onSuccess: () => void }];
    act(() => again.onSuccess());
    expect(screen.getByRole("status")).toHaveTextContent("Đã lưu");
  });

  it("links to the full task page inside the workspace", () => {
    taskState.current = loadedTask;
    const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/", searchParams: new URLSearchParams() };
    const workspace = { id: "ws1", slug: "team", name: "Team", organization_slug: "acme" };
    wrap(
      <NavigationProvider value={nav as unknown as NavigationAdapter}>
        <WorkspaceProvider workspace={workspace as never} user={{} as never}>
          {peek}
        </WorkspaceProvider>
      </NavigationProvider>,
    );
    expect(screen.getByRole("link", { name: "Mở việc" })).toHaveAttribute("href", "/acme/team/tasks/t1");
  });
});
