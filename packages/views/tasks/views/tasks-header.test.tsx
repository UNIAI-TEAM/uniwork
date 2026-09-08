import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { wrap } from "../../test/api-mock";
import { TasksHeader } from "./tasks-header";

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

async function openModeMenu() {
  fireEvent.click(screen.getByTestId("task-mode-switcher"));
  await waitFor(() => {
    expect(screen.getByTestId("task-mode-list")).toBeInTheDocument();
  });
}

describe("TasksHeader mode switcher", () => {
  it("exposes every mode passed via props (workspace five)", async () => {
    const store = getTaskSurfaceViewStore("test-header-modes");
    store.getState().setViewMode("list");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <TasksHeader
            workspaceId="w1"
            modes={["board", "list", "table", "gantt", "swimlane"]}
            scopedTasks={[]}
            isRefreshing={false}
          />
        </ViewStoreProvider>,
      ),
    );

    await openModeMenu();
    expect(screen.getByTestId("task-mode-board")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-list")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-table")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-gantt")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-swimlane")).toBeInTheDocument();
  });

  it("omits modes not in the props list", async () => {
    const store = getTaskSurfaceViewStore("test-header-modes-subset");
    store.getState().setViewMode("list");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <TasksHeader
            workspaceId="w1"
            modes={["board", "list"]}
            scopedTasks={[]}
            isRefreshing={false}
          />
        </ViewStoreProvider>,
      ),
    );

    await openModeMenu();
    expect(screen.getByTestId("task-mode-board")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-list")).toBeInTheDocument();
    expect(screen.queryByTestId("task-mode-gantt")).toBeNull();
    expect(screen.queryByTestId("task-mode-table")).toBeNull();
  });
});
