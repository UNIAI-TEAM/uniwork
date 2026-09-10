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
  it("keeps secondary actions out of the main toolbar without an empty chips row", () => {
    const store = getTaskSurfaceViewStore("test-header-layout");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <TasksHeader
            workspaceId="w1"
            modes={["board", "list"]}
            scopedTasks={[]}
            projectGroupingDisabled
            projectGroupingReasonKey="capabilities.unknown"
          />
        </ViewStoreProvider>,
      ),
    );

    const toolbar = screen.getByTestId("tasks-toolbar");
    expect(toolbar).not.toContainElement(
      screen.queryByRole("button", { name: "Lưu view" }),
    );
    expect(toolbar).not.toContainElement(
      screen.queryByRole("button", { name: "Nhóm theo dự án" }),
    );
    expect(screen.queryByTestId("tasks-filter-chips")).toBeNull();
  });

  it("groups view creation and management in one view menu", async () => {
    const store = getTaskSurfaceViewStore("test-header-view-menu");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <TasksHeader workspaceId="w1" modes={["board"]} scopedTasks={[]} />
        </ViewStoreProvider>,
      ),
    );

    expect(screen.queryByRole("button", { name: "View mới" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Quản lý view" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Thêm view" }));
    expect(
      await screen.findByRole("menuitem", { name: "View mới" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Quản lý view" }),
    ).toBeInTheDocument();
  });

  it("shows compact display controls and keeps integrations in their menu", async () => {
    const store = getTaskSurfaceViewStore("test-header-action-groups");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <TasksHeader
            workspaceId="w1"
            modes={["board"]}
            scopedTasks={[]}
            projectGroupingDisabled
            projectGroupingReasonKey="capabilities.unknown"
          />
        </ViewStoreProvider>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Hiển thị" }));
    expect(
      await screen.findByRole("combobox", { name: "Nhóm" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Sắp xếp" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Hiện sub-task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Độ ưu tiên" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Nhãn" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Thêm thao tác" }));
    expect(
      await screen.findByRole("menuitem", { name: "VCS" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Đính kèm" }),
    ).toBeInTheDocument();
  });

  it("shows save view beside active filter chips", () => {
    const store = getTaskSurfaceViewStore("test-header-save-filtered-view");
    store.getState().toggleStatusFilter("todo");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <TasksHeader workspaceId="w1" modes={["board"]} scopedTasks={[]} />
        </ViewStoreProvider>,
      ),
    );

    const chips = screen.getByTestId("tasks-filter-chips");
    expect(chips).toContainElement(
      screen.getByRole("button", { name: "Lưu view" }),
    );
  });

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
