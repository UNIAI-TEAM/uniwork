import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { requestMock, wrap } from "../test/api-mock";
import { TaskSurfacePage } from "./task-surface-page";
import { TasksPageView } from "./tasks-page-view";

initI18n();

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTaskViews: () => ({
      data: { views: [], total: 0 },
      isSuccess: true,
      isFetching: false,
    }),
    useTaskViewPreference: () => ({ data: undefined }),
    usePutTaskViewPreference: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    useCreateTaskView: () => ({ mutate: vi.fn(), isPending: false }),
    usePatchTaskView: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteTaskView: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({
    tasks: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
});

async function openModeMenu() {
  fireEvent.click(screen.getByTestId("task-mode-switcher"));
  await waitFor(() => {
    expect(screen.getByTestId("task-mode-list")).toBeInTheDocument();
  });
}

describe("TaskSurfacePage", () => {
  it("renders the workspace five-mode switcher", async () => {
    const store = getTaskSurfaceViewStore("workspace:all");
    store.getState().setViewMode("list");

    render(
      wrap(
        <TaskSurfacePage workspaceId="w1" onOpenTask={() => {}} />,
      ),
    );

    expect(await screen.findByTestId("task-mode-switcher")).toBeInTheDocument();
    await openModeMenu();
    expect(screen.getByTestId("task-mode-board")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-list")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-table")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-gantt")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-swimlane")).toBeInTheDocument();
  });
});

describe("TasksPageView (MVP, flag-off)", () => {
  it("keeps only board and list modes when tested in isolation", async () => {
    render(wrap(<TasksPageView workspaceId="w1" onOpenTask={() => {}} />));

    expect(
      await screen.findByRole("group", { name: /Kiểu hiển thị|View mode/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bảng|Board/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Danh sách|List/i })).toBeInTheDocument();
    expect(screen.queryByTestId("task-mode-switcher")).toBeNull();
    expect(screen.queryByTestId("task-mode-table")).toBeNull();
    expect(screen.queryByTestId("task-mode-gantt")).toBeNull();
    expect(screen.queryByTestId("task-mode-swimlane")).toBeNull();
  });
});
