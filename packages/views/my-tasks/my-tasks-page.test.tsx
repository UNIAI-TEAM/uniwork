import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { myTasksViewStore } from "@uniwork/core/tasks/stores/my-tasks-view-store";
import { requestMock, wrap } from "../test/api-mock";
import { MyTasksPageView } from "./my-tasks-page";

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
  myTasksViewStore.setState({ scope: "all" });
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/api/v1/config")) {
      return {
        flags: {},
        rum_sample_rate: 0,
        work_management_capabilities: {
          "tasks.agent_runs": {
            status: "unavailable",
            reason_code: "not_shipped",
            explanation_key: "capabilities.unknown",
          },
        },
      };
    }
    if (typeof path === "string" && path.includes("/my-tasks")) {
      return { tasks: [], total: 0, limit: 50, offset: 0 };
    }
    if (typeof path === "string" && path.includes("/members")) {
      return { members: [] };
    }
    return { tasks: [], total: 0, limit: 50, offset: 0 };
  });
});

describe("MyTasksPageView", () => {
  it("switches assigned scope and asks the table API for relation=assigned", async () => {
    render(
      wrap(
        <MyTasksPageView
          workspaceId="w1"
          userId="u1"
          onOpenTask={() => {}}
        />,
      ),
    );

    expect(await screen.findByTestId("my-tasks-scope-assigned")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("my-tasks-scope-assigned"));

    await waitFor(() => {
      expect(
        requestMock.mock.calls.some(
          ([path, init]) =>
            typeof path === "string" &&
            path.includes("/tasks/table/groups") &&
            (init as { body?: { query?: { filter?: { relation?: string } } } })
              ?.body?.query?.filter?.relation === "assigned",
        ),
      ).toBe(true);
    });
    expect(myTasksViewStore.getState().scope).toBe("assigned");
  });

  it("disables involved scope when agent_runs unavailable", async () => {
    render(
      wrap(
        <MyTasksPageView
          workspaceId="w1"
          userId="u1"
          onOpenTask={() => {}}
        />,
      ),
    );

    const involved = await screen.findByTestId("my-tasks-scope-involved");
    expect(involved).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(involved);
    expect(myTasksViewStore.getState().scope).toBe("all");
  });

  it("exposes board list table swimlane without gantt", async () => {
    myTasksViewStore.setState({ scope: "assigned" });
    render(
      wrap(
        <MyTasksPageView
          workspaceId="w1"
          userId="u1"
          onOpenTask={() => {}}
        />,
      ),
    );

    fireEvent.click(await screen.findByTestId("task-mode-switcher"));
    await waitFor(() => {
      expect(screen.getByTestId("task-mode-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("task-mode-board")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-swimlane")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-table")).toBeInTheDocument();
    expect(screen.queryByTestId("task-mode-gantt")).toBeNull();
  });

  it("keeps list mode on the flat my-tasks query with the relation param", async () => {
    myTasksViewStore.setState({ scope: "created" });
    getTaskSurfaceViewStore("my:u1:created").getState().setViewMode("list");

    render(
      wrap(
        <MyTasksPageView
          workspaceId="w1"
          userId="u1"
          onOpenTask={() => {}}
        />,
      ),
    );

    await waitFor(() => {
      expect(
        requestMock.mock.calls.some(
          ([path]) =>
            typeof path === "string" &&
            path.includes("/my-tasks") &&
            path.includes("relation=created"),
        ),
      ).toBe(true);
    });
    expect(
      requestMock.mock.calls.some(
        ([path]) =>
          typeof path === "string" && path.includes("/tasks/table/groups"),
      ),
    ).toBe(false);
  });
});
