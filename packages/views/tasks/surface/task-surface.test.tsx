import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { requestMock, wrap } from "../../test/api-mock";
import { TaskSurface } from "./task-surface";

initI18n();

const task = (over: Record<string, unknown>) => ({
  id: "t1",
  workspace_id: "w1",
  title: "Alpha",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
  ...over,
});

let tableRowsTotal = 1;
let tableChildCount = 0;
let queryTasks: Array<Record<string, unknown>> = [task({})];

beforeEach(() => {
  tableRowsTotal = 1;
  tableChildCount = 0;
  queryTasks = [task({})];
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    if (typeof path === "string" && path.includes("/tasks/table/groups")) {
      return {
        query_fingerprint: "fp-groups",
        total: tableRowsTotal,
        groups: [
          {
            key: "status:todo",
            value: { kind: "status", status: "todo" },
            count: tableRowsTotal,
          },
        ],
        next_cursor: null,
      };
    }
    if (typeof path === "string" && path.includes("/tasks/table/rows")) {
      const body = (init?.body ?? {}) as { limit?: number; offset?: number };
      const limit = body.limit ?? 50;
      const offset = body.offset ?? 0;
      // Cap page size in the truncated fixture so the table stays under the
      // virtualization threshold in jsdom (no scroll height → empty window).
      const pageLimit =
        tableRowsTotal > 50 ? Math.min(limit, 5) : limit;
      const rows = Array.from(
        { length: Math.min(pageLimit, Math.max(0, tableRowsTotal - offset)) },
        (_, i) => ({
          task: task({
            id: `t${offset + i + 1}`,
            title: `Task ${offset + i + 1}`,
          }),
          direct_child_count: i === 0 && offset === 0 ? tableChildCount : 0,
        }),
      );
      return {
        query_fingerprint: "fp-rows",
        group_key: "status:todo",
        parent_id: null,
        total: tableRowsTotal,
        rows,
        branch_total: tableRowsTotal,
        next_cursor: null,
      };
    }
    if (typeof path === "string" && path.includes("/tasks/table/facets")) {
      return {
        query_fingerprint: "fp-facets",
        total: tableRowsTotal,
        facets: [{ kind: "status", values: [{ key: "todo", count: tableRowsTotal }] }],
      };
    }
    return {
      tasks: queryTasks,
      total: queryTasks.length,
      limit: 50,
      offset: 0,
    };
  });
});

describe("TaskSurface", () => {
  it("lists tasks from suite query when list mode active", async () => {
    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["list"]}
          surfaceKey="test-ws-list"
        />,
      ),
    );
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });

  it("calls table groups endpoint when table mode active", async () => {
    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["table"]}
          surfaceKey="test-ws-table"
        />,
      ),
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/tasks/table/groups"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Task 1")).toBeInTheDocument();
  });

  it("scopes table groups by project_ids when project scope", async () => {
    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "project", projectId: "p1" }}
          modes={["table"]}
          surfaceKey="test-project-table"
        />,
      ),
    );

    await waitFor(() => {
      const groupsCall = requestMock.mock.calls.find(
        ([path]) =>
          typeof path === "string" && path.includes("/tasks/table/groups"),
      );
      expect(groupsCall).toBeDefined();
      const init = groupsCall?.[1] as
        | { body?: { filter?: { project_ids?: string[] } } }
        | undefined;
      expect(init?.body?.filter?.project_ids).toEqual(["p1"]);
    });
  });

  it("does not request table groups for my-scope even if table is in modes", async () => {
    const store = getTaskSurfaceViewStore("test-my-no-table");
    store.getState().setViewMode("table");

    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "my", userId: "u1", relation: "all" }}
          modes={["board", "list", "table", "swimlane"]}
          surfaceKey="test-my-no-table"
        />,
      ),
    );

    await waitFor(() => {
      expect(
        requestMock.mock.calls.some(
          ([path]) =>
            typeof path === "string" && path.includes("/my-tasks"),
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

  it("disables hierarchy chevron when children fetch is unavailable", async () => {
    tableChildCount = 2;
    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["table"]}
          surfaceKey="test-ws-table-hierarchy"
        />,
      ),
    );

    expect(await screen.findByText("Task 1")).toBeInTheDocument();
    // Full suite may leave i18n on en; match both catalogue strings.
    const chevron = await screen.findByRole("button", {
      name: /Chưa khả dụng|Not available yet/,
    });
    expect(chevron).toBeDisabled();
    expect(chevron.title).toMatch(/Chưa khả dụng|Not available yet/);
  });

  it("loads the next offset page when group rows are truncated", async () => {
    tableRowsTotal = 51;
    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["table"]}
          surfaceKey="test-ws-table-load-more"
        />,
      ),
    );

    expect(await screen.findByText("Task 1")).toBeInTheDocument();
    expect(screen.queryByText("Task 51")).not.toBeInTheDocument();
    expect(
      await screen.findByText(/Hiển thị 5\/51|Showing 5 of 51/),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /tải thêm|load more/i }));

    expect(await screen.findByText("Task 51")).toBeInTheDocument();
    await waitFor(() => {
      const rowCalls = requestMock.mock.calls.filter(
        ([path]) => typeof path === "string" && path.includes("/tasks/table/rows"),
      );
      expect(
        rowCalls.some(([, init]) => {
          const body = (init as { body?: { offset?: number } } | undefined)?.body;
          return body?.offset === 50;
        }),
      ).toBe(true);
    });
  });

  it("shows surface empty with create in gantt when zero tasks exist", async () => {
    queryTasks = [];
    const store = getTaskSurfaceViewStore("test-ws-gantt-surface-empty");
    store.getState().setViewMode("gantt");

    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["gantt", "list"]}
          surfaceKey="test-ws-gantt-surface-empty"
        />,
      ),
    );

    expect(
      await screen.findByText(/Chưa có công việc nào|No tasks yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("gantt-empty")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/chưa có task đã lên lịch|no scheduled tasks/i),
    ).not.toBeInTheDocument();
  });

  it("does not mark the surface empty in gantt when only undated tasks exist", async () => {
    queryTasks = [task({ id: "undated", title: "No dates yet" })];
    const store = getTaskSurfaceViewStore("test-ws-gantt-empty");
    store.getState().setViewMode("gantt");

    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["gantt", "list"]}
          surfaceKey="test-ws-gantt-empty"
        />,
      ),
    );

    expect(
      await screen.findByText(/chưa có task đã lên lịch|no scheduled tasks/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Chưa có công việc nào")).not.toBeInTheDocument();
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
  });

  it("renders swimlane assignee lanes from surface tasks", async () => {
    queryTasks = [
      task({
        id: "a1",
        title: "Assigned work",
        assignee_id: "user-1",
        assignee_kind: "human",
        status: "todo",
      }),
      task({
        id: "u1",
        title: "Unassigned work",
        status: "in_progress",
      }),
    ];
    const store = getTaskSurfaceViewStore("test-ws-swimlane");
    store.getState().setViewMode("swimlane");
    store.getState().setSwimlaneGrouping("assignee");

    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["swimlane", "list"]}
          surfaceKey="test-ws-swimlane"
        />,
      ),
    );

    expect(await screen.findByTestId("swimlane-view")).toBeInTheDocument();
    expect(await screen.findByText("Assigned work")).toBeInTheDocument();
    expect(screen.getByText("Unassigned work")).toBeInTheDocument();
    expect(
      screen.getByTestId("swimlane-lane-assignee:none"),
    ).toBeInTheDocument();
  });
});
