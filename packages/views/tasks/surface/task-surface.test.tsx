import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { taskKeys } from "@uniwork/core/tasks";
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
      screen.queryByText(/chưa có việc đã lên lịch|no scheduled tasks/i),
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
      await screen.findByText(/chưa có việc đã lên lịch|no scheduled tasks/i),
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

// --- Paging: the suite query and my-tasks serve 50 rows at a time. ---

const PAGED_STATUSES = ["backlog", "todo", "in_progress"] as const;

/** Spread over three statuses so no list group passes the 50-row virtualization threshold. */
function pagedRow(index: number, over: Record<string, unknown> = {}) {
  return task({
    id: `t${index}`,
    title: `Task ${index}`,
    status: PAGED_STATUSES[index % PAGED_STATUSES.length],
    position: index,
    start_date: "2026-09-01",
    due_date: "2026-09-20",
    ...over,
  });
}

interface PagedServerOptions {
  total: number;
  /** Pages after the first start this many rows early, repeating ids across the boundary. */
  overlap?: number;
  /** Offsets whose first request fails. */
  failOnce?: number[];
  /** Offsets answered with a body that is not a task page. */
  malformed?: number[];
  /** Offset held until `release()` is called. */
  hold?: number;
  /** Hold only this request of the `hold` offset, counting from 1; by default every one waits. */
  holdNth?: number;
  row?: (index: number, params: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * A fake paging server behind the mocked transport: `/tasks/query` reads its
 * paging from the JSON body, `/my-tasks` from the query string, as the real
 * endpoints do. Every other path gets an empty page.
 */
function servePagedTasks(options: PagedServerOptions) {
  const seen: Array<{ path: string; params: Record<string, unknown> }> = [];
  const failed = new Set<number>();
  const requestsPerOffset = new Map<number, number>();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    const isQuery = typeof path === "string" && path.includes("/tasks/query");
    const isMine = typeof path === "string" && path.includes("/my-tasks");
    if (!isQuery && !isMine) return { tasks: [], total: 0, limit: 50, offset: 0 };
    const params: Record<string, unknown> = isQuery
      ? { ...(init?.body as Record<string, unknown> | undefined) }
      : Object.fromEntries(new URL(path, "http://test").searchParams);
    seen.push({ path, params });
    const offset = Number(params.offset ?? 0);
    const limit = Number(params.limit ?? 50);
    const nth = (requestsPerOffset.get(offset) ?? 0) + 1;
    requestsPerOffset.set(offset, nth);
    if (options.hold === offset && (options.holdNth === undefined || options.holdNth === nth)) {
      await held;
    }
    if (options.failOnce?.includes(offset) && !failed.has(offset)) {
      failed.add(offset);
      throw new Error("page failed");
    }
    if (options.malformed?.includes(offset)) return { unexpected: true };
    const start = offset > 0 ? Math.max(0, offset - (options.overlap ?? 0)) : 0;
    const count = Math.max(0, Math.min(limit, options.total - start));
    const row = options.row ?? ((index: number) => pagedRow(index));
    return {
      tasks: Array.from({ length: count }, (_, k) => row(start + k, params)),
      total: options.total,
      limit,
      offset,
    };
  });
  return {
    offsets: () => seen.map((request) => Number(request.params.offset ?? 0)),
    seen,
    release: () => release(),
  };
}

const listRows = () => document.querySelectorAll("[data-task-list-row]").length;
const loadMoreButton = () => screen.getByRole("button", { name: "Tải thêm" });

/** Clicks load more once the button is live again; a click while inert is a no-op. */
async function clickLoadMore() {
  const button = await waitFor(() => {
    const element = loadMoreButton();
    expect(element).not.toHaveAttribute("aria-disabled", "true");
    return element;
  });
  fireEvent.click(button);
}

function renderSurface(
  surfaceKey: string,
  scope: Parameters<typeof TaskSurface>[0]["scope"] = { type: "workspace" },
  modes: Parameters<typeof TaskSurface>[0]["modes"] = ["list"],
) {
  return render(
    wrap(
      <TaskSurface workspaceId="w1" scope={scope} modes={modes} surfaceKey={surfaceKey} />,
    ),
  );
}

/** Stands in for the realtime sync: a task event invalidates the query root. */
function RealtimeRefetch() {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      aria-label="realtime refetch"
      onClick={() => void qc.invalidateQueries({ queryKey: taskKeys.queryRoot("w1") })}
    />
  );
}

function renderWithRealtimeRefetch(surfaceKey: string) {
  return render(
    wrap(
      <>
        <RealtimeRefetch />
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["list"]}
          surfaceKey={surfaceKey}
        />
      </>,
    ),
  );
}

describe("TaskSurface pagination (pages of 50)", () => {
  const LONG = 60_000;

  beforeEach(() => {
    // The load-more row is the tested path. The shared setup's observer reports
    // "visible" on observe (test/media-stub.ts), which would load a page on
    // mount; the sentinel has its own case below.
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list walks all 120 tasks from the load-more row, 50 at a time, then marks the end", async () => {
    const server = servePagedTasks({ total: 120 });
    renderSurface("test-paged-list");

    await waitFor(() => expect(listRows()).toBe(50), { timeout: LONG });
    expect(screen.getByText("50 / 120 công việc đã tải")).toBeInTheDocument();

    await clickLoadMore();
    await waitFor(() => expect(listRows()).toBe(100), { timeout: LONG });
    expect(await screen.findByText("100 / 120 công việc đã tải", undefined, { timeout: LONG })).toBeInTheDocument();

    await clickLoadMore();
    await waitFor(() => {
      expect(listRows()).toBe(120);
      expect(screen.getByText("Không còn công việc để tải")).toBeInTheDocument();
    }, { timeout: LONG });
    expect(screen.queryByText(/công việc đã tải/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Tải thêm" })).toBeNull();
    expect(server.offsets()).toEqual([0, 50, 100]);
  }, LONG);

  it("list announces the page in flight and keeps the button inert until it lands", async () => {
    const server = servePagedTasks({ total: 120, hold: 50 });
    renderSurface("test-paged-list-loading");

    await waitFor(() => expect(listRows()).toBe(50));
    await clickLoadMore();

    await waitFor(() =>
      expect(
        within(screen.getByTestId("load-more-footer")).getByRole("status"),
      ).toHaveTextContent("Đang tải thêm công việc…"),
    );
    expect(loadMoreButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(loadMoreButton());
    expect(server.offsets()).toEqual([0, 50]);

    server.release();
    await waitFor(() => expect(listRows()).toBe(100));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("load-more-footer")).getByRole("status"),
      ).toBeEmptyDOMElement(),
    );
    expect(server.offsets()).toEqual([0, 50]);
  }, 30_000);

  it("a load more clicked while a realtime refetch runs asks for the next page once the refetch lands", async () => {
    // The second request for offset 0 is the refetch; hold it so the click lands mid-refetch.
    const server = servePagedTasks({ total: 120, hold: 0, holdNth: 2 });
    renderWithRealtimeRefetch("test-paged-refetch-click");
    await waitFor(() => expect(listRows()).toBe(50));

    fireEvent.click(screen.getByRole("button", { name: "realtime refetch" }));
    await waitFor(() => expect(server.offsets()).toEqual([0, 0]));
    expect(loadMoreButton()).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(loadMoreButton());

    server.release();
    await waitFor(() => expect(listRows()).toBe(100));
    expect(server.offsets()).toEqual([0, 0, 50]);
  }, 30_000);

  it("a load more waiting behind a realtime refetch shows the page as loading until it lands", async () => {
    const server = servePagedTasks({ total: 120, hold: 0, holdNth: 2 });
    renderWithRealtimeRefetch("test-paged-refetch-busy");
    await waitFor(() => expect(listRows()).toBe(50));

    fireEvent.click(screen.getByRole("button", { name: "realtime refetch" }));
    await waitFor(() => expect(server.offsets()).toEqual([0, 0]));
    fireEvent.click(loadMoreButton());

    expect(loadMoreButton()).toHaveAttribute("aria-disabled", "true");
    expect(
      within(screen.getByTestId("load-more-footer")).getByRole("status"),
    ).toHaveTextContent("Đang tải thêm công việc…");
    // Inert while it waits: a second click does not queue a second page.
    fireEvent.click(loadMoreButton());

    server.release();
    await waitFor(() => expect(listRows()).toBe(100));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("load-more-footer")).getByRole("status"),
      ).toBeEmptyDOMElement(),
    );
    expect(server.offsets()).toEqual([0, 0, 50]);
  }, 30_000);

  it("a load more still lands when a second realtime refetch cancels the one it waited behind", async () => {
    // Request 2 for offset 0 is the first refetch, held so the click joins it.
    // The second refetch (request 3) cancels it, which settles the click's wait
    // without a page while that second refetch is still running.
    const server = servePagedTasks({ total: 120, hold: 0, holdNth: 2 });
    renderWithRealtimeRefetch("test-paged-refetch-twice");
    await waitFor(() => expect(listRows()).toBe(50));

    fireEvent.click(screen.getByRole("button", { name: "realtime refetch" }));
    await waitFor(() => expect(server.offsets()).toEqual([0, 0]));
    fireEvent.click(loadMoreButton());
    fireEvent.click(screen.getByRole("button", { name: "realtime refetch" }));

    server.release();
    await waitFor(() => expect(listRows()).toBe(100));
    expect(server.offsets()).toEqual([0, 0, 0, 50]);
  }, 30_000);

  it("list keeps the loaded rows when the next page fails and retries that page", async () => {
    const server = servePagedTasks({ total: 120, failOnce: [50] });
    renderSurface("test-paged-list-error");

    await waitFor(() => expect(listRows()).toBe(50));
    await clickLoadMore();

    expect(await screen.findByText("Không tải thêm được công việc.")).toBeInTheDocument();
    expect(listRows()).toBe(50);
    expect(screen.queryByTestId("task-surface-error")).toBeNull();

    fireEvent.click(
      within(screen.getByTestId("load-more-footer")).getByRole("button", {
        name: "Thử lại",
      }),
    );
    await waitFor(() => expect(listRows()).toBe(100));
    expect(server.offsets()).toEqual([0, 50, 50]);
  }, 30_000);

  it("My Tasks list pages through /my-tasks the same way", async () => {
    const server = servePagedTasks({ total: 120 });
    renderSurface("test-paged-my", { type: "my", userId: "u1", relation: "assigned" });

    await waitFor(() => expect(listRows()).toBe(50));
    await clickLoadMore();
    await waitFor(() => expect(listRows()).toBe(100));
    await clickLoadMore();
    await waitFor(() => expect(listRows()).toBe(120));

    expect(server.offsets()).toEqual([0, 50, 100]);
    expect(
      server.seen.every(
        (request) =>
          request.path.includes("/my-tasks") && request.params.relation === "assigned",
      ),
    ).toBe(true);
  }, 30_000);

  it("gantt shows loaded / total with a load-more button until everything is loaded", async () => {
    servePagedTasks({ total: 120 });
    getTaskSurfaceViewStore("test-paged-gantt").getState().setViewMode("gantt");
    renderSurface("test-paged-gantt", { type: "workspace" }, ["gantt", "list"]);

    expect(await screen.findByTestId("gantt-view")).toBeInTheDocument();
    expect(await screen.findByText("50 / 120 công việc đã tải")).toBeInTheDocument();
    await clickLoadMore();
    expect(await screen.findByText("100 / 120 công việc đã tải")).toBeInTheDocument();
    await clickLoadMore();

    await waitFor(() => expect(screen.queryByText(/công việc đã tải/)).toBeNull());
    expect(screen.queryByRole("button", { name: "Tải thêm" })).toBeNull();
  }, 30_000);

  it("swimlane shows loaded / total with a load-more button that raises the count", async () => {
    servePagedTasks({ total: 120 });
    getTaskSurfaceViewStore("test-paged-swimlane").getState().setViewMode("swimlane");
    renderSurface("test-paged-swimlane", { type: "workspace" }, ["swimlane", "list"]);

    expect(await screen.findByTestId("swimlane-view")).toBeInTheDocument();
    expect(await screen.findByText("50 / 120 công việc đã tải")).toBeInTheDocument();
    await clickLoadMore();

    expect(await screen.findByText("100 / 120 công việc đã tải")).toBeInTheDocument();
  }, 30_000);

  it("changing the project starts again from the first page without the old project's rows", async () => {
    const server = servePagedTasks({
      total: 120,
      row: (index, params) =>
        pagedRow(index, {
          id: `${String(params.project_id)}-t${index}`,
          title: `${String(params.project_id)} task ${index}`,
        }),
    });
    function ProjectSwitch() {
      const [projectId, setProjectId] = useState("p1");
      return (
        <>
          <button type="button" aria-label="switch project" onClick={() => setProjectId("p2")} />
          <TaskSurface
            workspaceId="w1"
            scope={{ type: "project", projectId }}
            modes={["list"]}
            surfaceKey="test-paged-project"
          />
        </>
      );
    }
    render(wrap(<ProjectSwitch />));

    await waitFor(() => expect(listRows()).toBe(50));
    await clickLoadMore();
    await waitFor(() => expect(listRows()).toBe(100));

    fireEvent.click(screen.getByRole("button", { name: "switch project" }));

    expect(await screen.findByText("p2 task 0")).toBeInTheDocument();
    await waitFor(() => expect(listRows()).toBe(50));
    expect(screen.queryAllByText(/^p1 task/)).toHaveLength(0);
    expect(
      server.seen
        .filter((request) => request.params.project_id === "p2")
        .map((request) => request.params.offset),
    ).toEqual([0]);
    expect(screen.getByText("50 / 120 công việc đã tải")).toBeInTheDocument();
  }, 30_000);

  it("is not empty while the first page loads, nor while later pages remain behind hidden rows", async () => {
    const server = servePagedTasks({
      total: 120,
      hold: 0,
      row: (index) => pagedRow(index, { parent_task_id: "parent-1" }),
    });
    const store = getTaskSurfaceViewStore("test-paged-empty");
    store.getState().toggleShowSubTasks();
    expect(store.getState().showSubTasks).toBe(false);
    renderSurface("test-paged-empty");

    expect(await screen.findByTestId("task-surface-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("task-surface-empty")).toBeNull();

    server.release();

    expect(await screen.findByRole("button", { name: "Tải thêm" })).toBeInTheDocument();
    expect(screen.queryByTestId("task-surface-empty")).toBeNull();
    expect(listRows()).toBe(0);
  }, 30_000);

  it("a task that shifts across the page boundary renders once and is counted once", async () => {
    servePagedTasks({ total: 120, overlap: 1 });
    renderSurface("test-paged-dedupe");

    await waitFor(() => expect(listRows()).toBe(50));
    await clickLoadMore();

    expect(await screen.findByText("99 / 120 công việc đã tải")).toBeInTheDocument();
    expect(listRows()).toBe(99);
    expect(screen.getAllByText("Task 49")).toHaveLength(1);
  }, 30_000);

  it("a malformed later page neither zeroes the total nor drops the loaded rows", async () => {
    const server = servePagedTasks({ total: 120, malformed: [50] });
    renderSurface("test-paged-malformed");

    await waitFor(() => expect(listRows()).toBe(50));
    await clickLoadMore();

    await waitFor(() => expect(server.offsets()).toEqual([0, 50]));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Tải thêm" })).toBeNull(),
    );
    expect(listRows()).toBe(50);
    expect(screen.getByText("50 / 120 công việc đã tải")).toBeInTheDocument();
    expect(screen.queryByText(/\/ 0 /)).toBeNull();
  }, 30_000);
});

describe("TaskSurface pagination sentinel", () => {
  it("loads the next page once when the list end comes into view, and not again while it stays there", async () => {
    // Uses the shared setup's observer, which reports every observed node as
    // visible the moment it is observed (test/media-stub.ts). The page is held
    // so its loading state renders: the footer re-renders with new callbacks
    // twice while the sentinel stays mounted, which is when a rebuilt observer
    // would fire again.
    const server = servePagedTasks({ total: 120, hold: 50 });
    renderSurface("test-paged-sentinel");

    await waitFor(() =>
      expect(
        within(screen.getByTestId("load-more-footer")).getByRole("status"),
      ).toHaveTextContent("Đang tải thêm công việc…"),
    );
    server.release();
    await waitFor(() => expect(listRows()).toBe(100));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(server.offsets()).toEqual([0, 50]);
    expect(listRows()).toBe(100);
  }, 30_000);
});
