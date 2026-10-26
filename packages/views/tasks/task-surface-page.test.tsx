import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { fakeNav, requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { TaskSurfacePage } from "./task-surface-page";

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

    expect(
      screen.getByRole("heading", { level: 1, name: "Công việc" }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("task-mode-switcher")).toBeInTheDocument();
    await openModeMenu();
    expect(screen.getByTestId("task-mode-board")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-list")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-table")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-gantt")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-swimlane")).toBeInTheDocument();
  });

  it("links the header to the trash page when the host gives its address", () => {
    const nav = fakeNav("/acme/main/tasks");
    render(
      wrapWithNav(
        <TaskSurfacePage workspaceId="w1" onOpenTask={() => {}} trashHref="/acme/main/tasks/trash" />,
        nav,
      ),
    );
    const link = screen.getByRole("link", { name: "Thùng rác" });
    expect(link).toHaveAttribute("href", "/acme/main/tasks/trash");
    fireEvent.click(link);
    expect(nav.push).toHaveBeenCalledWith("/acme/main/tasks/trash");
  });

  it("shows no trash link without an address", () => {
    render(wrap(<TaskSurfacePage workspaceId="w1" onOpenTask={() => {}} />));
    expect(screen.queryByRole("link", { name: "Thùng rác" })).toBeNull();
  });
});
