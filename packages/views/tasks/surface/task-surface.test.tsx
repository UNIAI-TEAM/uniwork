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
    const store = getTaskSurfaceViewStore("test-ws-table");
    store.getState().setTableGrouping("status");

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
    const store = getTaskSurfaceViewStore("test-project-table");
    store.getState().setTableGrouping("status");

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

  it("shows hierarchy chevron when a row reports children", async () => {
    tableChildCount = 2;
    const store = getTaskSurfaceViewStore("test-ws-table-hierarchy");
    store.getState().setTableGrouping("status");

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
    // Expanded by default → collapse label; i18n may be vi or en.
    const chevron = await screen.findByRole("button", {
      name: /Thu công việc con|Collapse sub-tasks|Mở công việc con|Expand sub-tasks/,
    });
    expect(chevron).toBeEnabled();
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

  it("sends the batch toolbar's picked due date through surface actions to batch-update", async () => {
    // react-day-picker sits behind React.lazy in DateField; warm the chunk so
    // the waits below are on Suspense, not on a compile.
    await import("@uniwork/ui/components/ui/calendar");
    const store = getTaskSurfaceViewStore("test-ws-table-batch-due");
    store.getState().setTableGrouping("status");

    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["table"]}
          surfaceKey="test-ws-table-batch-due"
        />,
      ),
    );

    expect(await screen.findByText("Task 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Chọn công việc" }));
    // The toolbar's <label> names the DateField trigger; a column header
    // button that also reads "Hạn" is not a labelled control.
    fireEvent.click(await screen.findByLabelText("Hạn"));
    await screen.findAllByRole("gridcell", {}, { timeout: 20_000 });

    const now = new Date();
    const tenth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-10`;
    fireEvent.click(
      screen
        .getAllByRole("gridcell")
        .map((cell) => cell.querySelector("button"))
        .find((btn) => btn?.textContent === "10")!,
    );

    await waitFor(() => {
      const call = requestMock.mock.calls.find(
        ([path]) => typeof path === "string" && path.endsWith("/tasks/batch-update"),
      );
      expect(call).toEqual([
        "/api/v1/workspaces/w1/tasks/batch-update",
        { method: "POST", body: { task_ids: ["t1"], updates: { due_date: tenth } } },
      ]);
    });
  }, 60_000);

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

  it("hiển thị khối lỗi kèm nút thử lại khi query hỏng, không hiển thị trạng thái rỗng", async () => {
    requestMock.mockReset();
    requestMock.mockRejectedValue(new Error("network down"));

    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["list"]}
          surfaceKey="test-ws-error"
        />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId("task-surface-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("task-surface-empty")).not.toBeInTheDocument();
  });

  it("nút thử lại phát lại đúng truy vấn đã hỏng ở phạm vi my-tasks", async () => {
    requestMock.mockReset();
    requestMock.mockImplementation(async (path: string) => {
      if (typeof path === "string" && path.includes("/my-tasks")) {
        throw new Error("my-tasks down");
      }
      // task-statuses and everything else fall back to a benign default so
      // only the my-tasks query is the one that failed.
      return { tasks: queryTasks, total: queryTasks.length, limit: 50, offset: 0 };
    });

    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "my", userId: "u1", relation: "all" }}
          modes={["board", "list"]}
          surfaceKey="test-my-error-retry"
        />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId("task-surface-error")).toBeInTheDocument();
    });

    const myTasksCallsBefore = requestMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/my-tasks"),
    ).length;
    expect(myTasksCallsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));

    await waitFor(() => {
      const myTasksCallsAfter = requestMock.mock.calls.filter(
        ([path]) => typeof path === "string" && path.includes("/my-tasks"),
      ).length;
      expect(myTasksCallsAfter).toBeGreaterThan(myTasksCallsBefore);
    });
  });
});
