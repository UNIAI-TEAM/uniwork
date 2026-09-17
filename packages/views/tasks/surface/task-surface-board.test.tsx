import { QueryClientProvider, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { createQueryClient } from "@uniwork/core/query-client";
import { planCacheUpdate } from "@uniwork/core/tasks";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import type { TaskScope } from "@uniwork/core/tasks/surface/scope";
import { tableRowsPageBody, tableRowsPageQuery } from "@uniwork/core/tasks/surface/table-query";
import { localeAdapter, requestMock, wrap } from "../../test/api-mock";
import { boardTask, serveBoardTable } from "../../test/board-table-server";
import { TaskSurface, type TaskSurfaceController } from "./task-surface";
import type { TaskSurfaceMode } from "./types";

// jsdom has no layout, so the real Virtuoso renders an empty window. This one
// renders every card, then `components.Footer` with Virtuoso's `context`, and
// models react-virtuoso 4.18.13 `endReached`: it fires again whenever
// `[lastIndex, data]` changes by identity, so paging wired to it would walk
// every page here. A file of its own because vi.mock applies to the whole file.
vi.mock("react-virtuoso", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-virtuoso")>();
  const React = await import("react");
  function Virtuoso(props: {
    data: Array<{ id: string }>;
    itemContent: (index: number, item: { id: string }) => React.ReactNode;
    computeItemKey?: (index: number, item: { id: string }) => string;
    endReached?: (index: number) => void;
    components?: { Footer?: React.ComponentType<{ context?: unknown }> };
    context?: unknown;
  }) {
    const last = React.useRef<[number, unknown] | null>(null);
    React.useEffect(() => {
      const { data, endReached } = props;
      if (!data.length) return;
      const next: [number, unknown] = [data.length - 1, data];
      if (last.current && last.current[0] === next[0] && last.current[1] === next[1]) return;
      last.current = next;
      endReached?.(data.length - 1);
    });
    const Footer = props.components?.Footer;
    return (
      <div data-testid="fake-virtuoso">
        {props.data.map((item, index) => (
          <div key={props.computeItemKey ? props.computeItemKey(index, item) : index}>
            {props.itemContent(index, item)}
          </div>
        ))}
        {Footer ? <Footer context={props.context} /> : null}
      </div>
    );
  }
  return { ...actual, Virtuoso };
});

const i18n = initI18n();
const LONG = { timeout: 10_000 };

const column = (status: string) => screen.getByTestId(`board-column-${status}`);
const cardsIn = (status: string) =>
  column(status).querySelectorAll("[data-board-card]").length;
const heading = (status: string, count: number) =>
  within(column(status)).getByRole("heading", {
    name: `${i18n.t(`tasks.status_${status}`)}, ${count}`,
  });
const pagesOf = (requests: string[], status: string) =>
  requests.filter((page) => page.startsWith(`status:${status}@`));
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Clicks a column's load more once it is live again; a click while inert is a no-op. */
async function clickColumnLoadMore(status: string) {
  const button = await waitFor(() => {
    const element = within(column(status)).getByRole("button", { name: "Tải thêm" });
    expect(element).not.toHaveAttribute("aria-disabled", "true");
    return element;
  }, LONG);
  fireEvent.click(button);
}

/** Stands in for the realtime sync: invalidates what the cache plan names for task.updated. */
function RealtimeTaskUpdated() {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      aria-label="task.updated arrives"
      onClick={() => {
        const plan = planCacheUpdate("w1", { type: "task.updated", payload: { task_id: "todo-1" } });
        for (const queryKey of plan.keys) void qc.invalidateQueries({ queryKey });
      }}
    />
  );
}

function renderBoard(
  surfaceKey: string,
  scope: TaskScope = { type: "workspace" },
  modes: TaskSurfaceMode[] = ["board", "list"],
) {
  getTaskSurfaceViewStore(surfaceKey).getState().setViewMode("board");
  return render(
    wrap(
      <>
        <RealtimeTaskUpdated />
        <TaskSurface workspaceId="w1" scope={scope} modes={modes} surfaceKey={surfaceKey} />
      </>,
    ),
  );
}

describe("TaskSurface board columns on the table API", () => {
  beforeEach(() => {
    // Buttons are the tested path. The shared setup's observer reports every
    // node visible on observe (test/media-stub.ts), which would load a page on
    // mount; the sentinel has its own case below.
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries board-column and project-scope defaults into the create command", async () => {
    serveBoardTable({ counts: { todo: 1 } });
    renderBoard("board-create-defaults", { type: "project", projectId: "p1" });

    await waitFor(() => expect(cardsIn("todo")).toBe(1), LONG);
    fireEvent.click(
      within(column("todo")).getByRole("button", {
        name: i18n.t("tasks.surface.add_task"),
      }),
    );
    fireEvent.change(
      await screen.findByLabelText(i18n.t("tasks.create.title_placeholder")),
      {
        target: { value: "Created in todo" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.create") }));

    await waitFor(() => {
      const createCall = requestMock.mock.calls.find(
        ([path, init]) =>
          typeof path === "string" &&
          path.endsWith("/tasks") &&
          (init as { method?: string } | undefined)?.method === "POST",
      );
      expect(createCall?.[1]).toEqual(
        expect.objectContaining({
          body: expect.objectContaining({
            title: "Created in todo",
            status: "todo",
            project_id: "p1",
          }),
        }),
      );
    });
  });

  it("loads each column's first page on its own and heads it with the column total, not the cards loaded", async () => {
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3, done: 0 } });
    renderBoard("board-first-pages");

    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);
    expect(cardsIn("in_progress")).toBe(3);
    expect(cardsIn("done")).toBe(0);
    expect(heading("todo", 120)).toBeInTheDocument();
    expect(heading("in_progress", 3)).toBeInTheDocument();
    expect(within(column("done")).getByText(i18n.t("tasks.surface.empty_column"))).toBeInTheDocument();
    expect([...server.rowRequests()].sort()).toEqual(["status:in_progress@0", "status:todo@0"]);
    expect(server.groupBodies.every((body) => body.group_by === "status")).toBe(true);
    expect(server.paths.some((path) => path.includes("/tasks/grouped"))).toBe(false);
    expect(within(column("todo")).getByRole("button", { name: "Tải thêm" })).toBeInTheDocument();
    expect(within(column("in_progress")).queryByTestId("load-more-footer")).toBeNull();
  }, 60_000);

  it("loads more of one column only, one page per click, then marks that column's end", async () => {
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3 } });
    renderBoard("board-load-more");
    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);

    await clickColumnLoadMore("todo");
    await waitFor(() => expect(cardsIn("todo")).toBe(100), LONG);
    // Virtualised column: a page landing must not ask for the next one by itself.
    expect(within(column("todo")).getByTestId("fake-virtuoso")).toBeInTheDocument();
    await settle(300);
    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["status:todo@0", "status:todo@50"]);
    expect(pagesOf(server.rowRequests(), "in_progress")).toEqual(["status:in_progress@0"]);

    await clickColumnLoadMore("todo");
    await waitFor(() => expect(cardsIn("todo")).toBe(120), LONG);
    expect(within(column("todo")).getByText("Không còn công việc để tải")).toBeInTheDocument();
    expect(within(column("todo")).queryByRole("button", { name: "Tải thêm" })).toBeNull();
    expect(heading("todo", 120)).toBeInTheDocument();
    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["status:todo@0", "status:todo@50", "status:todo@100"]);
  }, 60_000);

  it("offers the column-end button below the virtualization threshold too", async () => {
    // One task in ten is top level and sub-tasks are hidden, so the column renders plainly.
    const server = serveBoardTable({
      counts: { todo: 120 },
      row: (status, index) =>
        boardTask(status, index, index % 10 === 0 ? {} : { parent_task_id: "parent" }),
    });
    getTaskSurfaceViewStore("board-under-threshold").getState().toggleShowSubTasks();
    renderBoard("board-under-threshold");
    await waitFor(() => expect(cardsIn("todo")).toBe(5), LONG);
    expect(within(column("todo")).queryByTestId("fake-virtuoso")).toBeNull();

    await clickColumnLoadMore("todo");

    await waitFor(() => expect(cardsIn("todo")).toBe(10), LONG);
    expect(server.rowRequests()).toEqual(["status:todo@0", "status:todo@50"]);
    expect(heading("todo", 120)).toBeInTheDocument();
  }, 60_000);

  it("a column load more clicked during a realtime refetch still gets exactly the next page", async () => {
    // The second request for todo's first page is the refetch; hold it so the click lands mid-refetch.
    const server = serveBoardTable({ counts: { todo: 120 }, hold: "status:todo@0", holdNth: 2 });
    renderBoard("board-refetch-click");
    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);

    fireEvent.click(screen.getByRole("button", { name: "task.updated arrives" }));
    await waitFor(() => expect(server.rowRequests()).toEqual(["status:todo@0", "status:todo@0"]), LONG);
    await clickColumnLoadMore("todo");
    await waitFor(() => expect(cardsIn("todo")).toBe(100), LONG);

    server.release();
    await settle(300);
    expect(server.rowRequests()).toEqual(["status:todo@0", "status:todo@0", "status:todo@50"]);
    expect(cardsIn("todo")).toBe(100);
  }, 60_000);

  it("a column whose page fails offers retry in that column and leaves the rest of the board alone", async () => {
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3 }, failOnce: ["status:todo@0"] });
    renderBoard("board-column-error");

    await waitFor(() => expect(cardsIn("in_progress")).toBe(3), LONG);
    const retry = await within(column("todo")).findByRole("button", { name: "Thử lại" }, LONG);
    expect(within(column("todo")).getByText("Không tải thêm được công việc.")).toBeInTheDocument();
    expect(within(column("todo")).queryByText(i18n.t("tasks.surface.empty_column"))).toBeNull();
    expect(screen.queryByTestId("task-surface-error")).toBeNull();
    expect(within(column("in_progress")).queryByRole("button", { name: "Thử lại" })).toBeNull();

    fireEvent.click(retry);

    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);
    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["status:todo@0", "status:todo@0", "status:todo@0"]);
  }, 60_000);

  it("a project board asks the table API for that project's groups and rows only", async () => {
    const server = serveBoardTable({ counts: { todo: 3 } });
    renderBoard("board-project", { type: "project", projectId: "p1" });

    await waitFor(() => expect(cardsIn("todo")).toBe(3), LONG);
    expect(server.groupBodies.length).toBeGreaterThan(0);
    expect(server.rowBodies.length).toBeGreaterThan(0);
    for (const body of [...server.groupBodies, ...server.rowBodies]) {
      expect((body.query as { filter?: unknown } | undefined)?.filter).toEqual({ project_ids: ["p1"] });
    }
  }, 60_000);

  it("a failed groups call is a surface error whose retry asks the table API again", async () => {
    const server = serveBoardTable({ counts: { todo: 3 }, failGroupsOnce: true });
    renderBoard("board-groups-error");

    const error = await screen.findByTestId("task-surface-error", {}, LONG);
    fireEvent.click(within(error).getByRole("button", { name: "Thử lại" }));

    await waitFor(() => expect(cardsIn("todo")).toBe(3), LONG);
    // The request and its automatic retry failed; the button asked a third time.
    expect(server.groupBodies).toHaveLength(3);
  }, 60_000);

  it("refetches the column pages when a task.updated event's cache plan is applied", async () => {
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3 } });
    renderBoard("board-realtime");
    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);
    const rowsBefore = server.rowRequests().length;
    const groupsBefore = server.groupBodies.length;

    fireEvent.click(screen.getByRole("button", { name: "task.updated arrives" }));

    await waitFor(() => expect(server.rowRequests()).toHaveLength(rowsBefore + 2), LONG);
    await waitFor(() => expect(server.groupBodies).toHaveLength(groupsBefore + 1), LONG);
    await settle(300);
    expect([...server.rowRequests().slice(rowsBefore)].sort()).toEqual(["status:in_progress@0", "status:todo@0"]);
    expect(cardsIn("todo")).toBe(50);
  }, 60_000);

  it("a board grouped by assignee says how much is loaded and loads more of every column with more", async () => {
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 60 } });
    getTaskSurfaceViewStore("board-assignee").getState().setGrouping("assignee");
    renderBoard("board-assignee");

    expect(await screen.findByText("100 / 180 công việc đã tải", {}, LONG)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    expect(await screen.findByText("160 / 180 công việc đã tải", {}, LONG)).toBeInTheDocument();
    expect([...server.rowRequests()].sort()).toEqual([
      "status:in_progress@0",
      "status:in_progress@50",
      "status:todo@0",
      "status:todo@50",
    ]);
  }, 60_000);

  it("My Tasks board stays off the table API, splits columns on the client and says how much is loaded", async () => {
    const server = serveBoardTable({ counts: {}, myTasks: 120 });
    renderBoard("board-my", { type: "my", userId: "u1", relation: "all" }, [
      "board",
      "list",
      "swimlane",
    ]);

    expect(await screen.findByText("50 / 120 công việc đã tải", {}, LONG)).toBeInTheDocument();
    // 50 tasks spread over backlog / todo / in_progress.
    expect(cardsIn("todo")).toBe(17);
    // The column counts the loaded cards only, and says so rather than read as its total.
    expect(
      within(column("todo")).getByRole("heading", { name: `${i18n.t("tasks.status_todo")}, 17 đã tải` }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    expect(await screen.findByText("100 / 120 công việc đã tải", {}, LONG)).toBeInTheDocument();
    expect(server.paths.some((path) => path.includes("/tasks/table/"))).toBe(false);
    expect(server.paths.some((path) => path.includes("/tasks/grouped"))).toBe(false);
  }, 60_000);

  it("My Tasks board says a hidden column's count is the tasks loaded, not its total", async () => {
    serveBoardTable({ counts: {}, myTasks: 120 });
    getTaskSurfaceViewStore("board-my-hidden").getState().hideStatus("todo");
    renderBoard("board-my-hidden", { type: "my", userId: "u1", relation: "all" }, ["board", "list"]);

    expect(await screen.findByText("50 / 120 công việc đã tải", {}, LONG)).toBeInTheDocument();
    expect(screen.queryByTestId("board-column-todo")).toBeNull();
    expect(screen.getByText("17 đã tải")).toBeInTheDocument();
  }, 60_000);
});

type StoredTask = Record<string, unknown> & { id: string; status: string; position: number };

/**
 * A table API over a task list the test can change, for moves: groups and
 * rows are computed from the list on every request and a PATCH writes it.
 * `hold(name)` parks every request named `groups`, `status:<status>@offset` or `PATCH`
 * until `release(name)`.
 */
function serveMovableBoard(initial: StoredTask[]) {
  const tasks = initial.map((task) => ({ ...task }));
  const requests: string[] = [];
  const gates = new Map<string, { held: Promise<void>; open: () => void }>();
  let failPatch = false;

  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    const body: Record<string, unknown> = { ...(init?.body as Record<string, unknown> | undefined) };
    const pass = async (name: string) => {
      requests.push(name);
      await gates.get(name)?.held;
    };
    if (path.includes("/tasks/table/groups")) {
      await pass("groups");
      const statuses = [...new Set(tasks.map((task) => task.status))].sort();
      return {
        query_fingerprint: "fp-groups",
        total: tasks.length,
        groups: statuses.map((status) => ({
          key: `status:${status}`,
          value: { kind: "status", status },
          count: tasks.filter((task) => task.status === status).length,
        })),
        next_cursor: null,
      };
    }
    if (path.includes("/tasks/table/rows")) {
      const offset = typeof body.cursor === "string" ? Number(atob(body.cursor)) : 0;
      await pass(`${String(body.group_key)}@${offset}`);
      const rows = tasks
        .filter((task) => `status:${task.status}` === body.group_key)
        .sort((a, b) => a.position - b.position);
      return {
        query_fingerprint: "fp-rows",
        group_key: body.group_key,
        parent_id: null,
        total: rows.length,
        rows: rows.map((task) => ({ task: { ...task }, direct_child_count: 0, labels: [] })),
        next_cursor: null,
      };
    }
    if (init?.method === "PATCH") {
      await pass("PATCH");
      if (failPatch) {
        failPatch = false;
        throw new Error("patch failed");
      }
      const task = tasks.find((row) => path.endsWith(`/${row.id}`))!;
      Object.assign(task, body);
      return { task: { ...task } };
    }
    return { tasks: [], total: 0, limit: 50, offset: 0 };
  });

  return {
    tasks,
    requests,
    hold: (name: string) => {
      let open = () => {};
      const held = new Promise<void>((resolve) => {
        open = resolve;
      });
      gates.set(name, { held, open });
    },
    release: (name: string) => {
      gates.get(name)?.open();
      gates.delete(name);
    },
    failNextPatch: () => {
      failPatch = true;
    },
  };
}

/** Whether the surface skeleton is put in the document at any moment from now until `stop()`. */
function watchForSkeleton() {
  const selector = '[data-testid="task-surface-skeleton"]';
  let seen = false;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) {
          seen = true;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    stop: () => {
      observer.disconnect();
      return seen;
    },
  };
}

/** The board on the app's own query client defaults, with its controller in reach for moves. */
function renderMovableBoard(surfaceKey: string, client: QueryClient = createQueryClient()) {
  const view: { controller?: TaskSurfaceController } = {};
  getTaskSurfaceViewStore(surfaceKey).getState().setViewMode("board");
  render(
    <QueryClientProvider client={client}>
      <LocaleAdapterProvider adapter={localeAdapter}>
        <RealtimeTaskUpdated />
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["board", "list"]}
          surfaceKey={surfaceKey}
          renderHeader={({ controller }) => {
            view.controller = controller;
            return null;
          }}
        />
      </LocaleAdapterProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    move: (taskId: string, updates: Record<string, unknown>) =>
      act(() => view.controller!.actions.moveTask(taskId, updates)),
  };
}

describe("TaskSurface board when a column fills after the first load", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a local move into an empty column keeps the board on screen instead of its skeleton", async () => {
    const server = serveMovableBoard([boardTask("todo", 0), boardTask("todo", 1)] as StoredTask[]);
    const board = renderMovableBoard("board-drop-empty-column");
    await waitFor(() => expect(cardsIn("todo")).toBe(2), LONG);
    const todoColumn = column("todo");
    const skeleton = watchForSkeleton();

    server.hold("PATCH");
    board.move("todo-0", { status: "done", position: 0 });
    await waitFor(() => expect(server.requests).toContain("PATCH"), LONG);
    // The refetch after the save is held, so its loading state is on screen for as long as it lasts.
    server.hold("status:done@0");
    server.release("PATCH");
    await waitFor(() => expect(server.requests).toContain("status:done@0"), LONG);
    await settle(300);

    expect(screen.queryByTestId("task-surface-skeleton")).toBeNull();
    expect(column("todo")).toBe(todoColumn);
    server.release("status:done@0");
    await waitFor(() => expect(cardsIn("done")).toBe(1), LONG);
    expect(cardsIn("todo")).toBe(1);
    expect(skeleton.stop()).toBe(false);
    expect(column("todo")).toBe(todoColumn);
  }, 60_000);

  it("a realtime refetch that brings a task into an empty column loads it in that column, not the board", async () => {
    const server = serveMovableBoard([boardTask("todo", 0), boardTask("todo", 1)] as StoredTask[]);
    renderMovableBoard("board-realtime-empty-column");
    await waitFor(() => expect(cardsIn("todo")).toBe(2), LONG);
    const todoColumn = column("todo");
    const skeleton = watchForSkeleton();

    // Another member moved todo-0 to done; its event invalidates the table root.
    server.tasks[0]!.status = "done";
    server.hold("status:done@0");
    fireEvent.click(screen.getByRole("button", { name: "task.updated arrives" }));
    await waitFor(() => expect(server.requests).toContain("status:done@0"), LONG);
    await settle(300);

    expect(screen.queryByTestId("task-surface-skeleton")).toBeNull();
    expect(within(column("done")).getByText("Đang tải thêm công việc…")).toBeInTheDocument();
    expect(column("todo")).toBe(todoColumn);
    server.release("status:done@0");
    await waitFor(() => expect(cardsIn("done")).toBe(1), LONG);
    expect(cardsIn("todo")).toBe(1);
    expect(skeleton.stop()).toBe(false);
    expect(column("todo")).toBe(todoColumn);
  }, 60_000);
});

/** Every card count of a column the document shows, from now until `stop()`. */
function trackCards(status: string) {
  const counts: number[] = [];
  const observer = new MutationObserver(() => {
    const element = document.querySelector(`[data-testid="board-column-${status}"]`);
    counts.push(element ? element.querySelectorAll("[data-board-card]").length : -1);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    stop: () => {
      observer.disconnect();
      return counts;
    },
  };
}

describe("TaskSurface board moves before the save lands", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("heads both columns with their new counts while the save is out, and with the old ones when it fails", async () => {
    const server = serveMovableBoard([
      boardTask("todo", 0),
      boardTask("todo", 1),
      boardTask("todo", 2),
      boardTask("done", 0),
    ] as StoredTask[]);
    const board = renderMovableBoard("board-move-counts");
    await waitFor(() => expect(cardsIn("todo")).toBe(3), LONG);
    expect(heading("done", 1)).toBeInTheDocument();

    server.hold("PATCH");
    board.move("todo-0", { status: "done", position: -1 });
    await waitFor(() => expect(server.requests).toContain("PATCH"), LONG);

    await waitFor(() => expect(heading("todo", 2)).toBeInTheDocument(), LONG);
    expect(heading("done", 2)).toBeInTheDocument();
    // The refetch after the failure is held, so the counts come from the rollback alone.
    for (const name of ["groups", "status:todo@0", "status:done@0"]) server.hold(name);
    server.failNextPatch();
    server.release("PATCH");

    await waitFor(() => expect(heading("done", 1)).toBeInTheDocument(), LONG);
    expect(heading("todo", 3)).toBeInTheDocument();
    expect(cardsIn("todo")).toBe(3);
    expect(cardsIn("done")).toBe(1);
    for (const name of ["groups", "status:todo@0", "status:done@0"]) server.release(name);
    await settle(300);
    expect(heading("todo", 3)).toBeInTheDocument();
    expect(heading("done", 1)).toBeInTheDocument();
  }, 60_000);

  it("a drop into an empty column shows the card there at once and keeps it through the save and the refetch", async () => {
    const server = serveMovableBoard([boardTask("todo", 0), boardTask("todo", 1)] as StoredTask[]);
    const board = renderMovableBoard("board-move-seeds-column");
    await waitFor(() => expect(cardsIn("todo")).toBe(2), LONG);
    const done = trackCards("done");

    server.hold("PATCH");
    board.move("todo-0", { status: "done", position: 0 });
    await waitFor(() => expect(cardsIn("done")).toBe(1), LONG);
    expect(heading("done", 1)).toBeInTheDocument();
    expect(heading("todo", 1)).toBeInTheDocument();
    await settle(300);
    // The seeded page is fresh under the app's staleTime, so the column does not
    // ask the server (which still has the task in todo) while the save is out.
    expect(server.requests).not.toContain("status:done@0");
    expect(cardsIn("done")).toBe(1);

    server.hold("status:done@0");
    server.release("PATCH");
    await waitFor(() => expect(server.requests).toContain("status:done@0"), LONG);
    await settle(300);
    expect(cardsIn("done")).toBe(1);
    server.release("status:done@0");
    await settle(300);

    expect(cardsIn("done")).toBe(1);
    expect(cardsIn("todo")).toBe(1);
    const counts = done.stop();
    expect(counts).toContain(1);
    expect(counts.slice(counts.indexOf(1))).not.toContain(0);
  }, 60_000);

  it("a drop into an empty column whose save fails takes the seeded page away and puts the card back", async () => {
    const server = serveMovableBoard([boardTask("todo", 0), boardTask("todo", 1)] as StoredTask[]);
    const client = createQueryClient();
    const board = renderMovableBoard("board-move-seed-fails", client);
    await waitFor(() => expect(cardsIn("todo")).toBe(2), LONG);
    const doneFirstPage = tableRowsPageQuery(
      "w1",
      tableRowsPageBody({
        query: {},
        groupBy: "status",
        hierarchy: false,
        groupKey: "status:done",
        parentId: null,
        cursor: null,
        limit: 50,
      }),
    ).queryKey;

    server.hold("PATCH");
    board.move("todo-0", { status: "done", position: 0 });
    await waitFor(() => expect(cardsIn("done")).toBe(1), LONG);
    expect(client.getQueryState(doneFirstPage)).toBeDefined();
    for (const name of ["groups", "status:todo@0"]) server.hold(name);
    server.failNextPatch();
    server.release("PATCH");

    await waitFor(() => expect(cardsIn("todo")).toBe(2), LONG);
    expect(cardsIn("done")).toBe(0);
    expect(heading("todo", 2)).toBeInTheDocument();
    expect(client.getQueryState(doneFirstPage)).toBeUndefined();
    for (const name of ["groups", "status:todo@0"]) server.release(name);
    await settle(300);
    expect(cardsIn("done")).toBe(0);
    expect(client.getQueryState(doneFirstPage)).toBeUndefined();
    expect(server.requests).not.toContain("status:done@0");
  }, 60_000);
});

describe("TaskSurface board column sentinel", () => {
  it("loads the next page of a column whose end is on screen once, and not again while it stays there", async () => {
    // Uses the shared setup's observer, which reports every observed node as
    // visible (test/media-stub.ts). The page is held so the column re-renders
    // in its loading state with the footer mounted; a footer remounted on
    // render would observe again and load another page.
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3 }, hold: "status:todo@50" });
    renderBoard("board-sentinel");

    await waitFor(
      () =>
        expect(within(column("todo")).getByTestId("load-more-footer")).toHaveTextContent(
          "Đang tải thêm công việc…",
        ),
      LONG,
    );
    server.release();
    await waitFor(() => expect(cardsIn("todo")).toBe(100), LONG);
    await settle(300);

    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["status:todo@0", "status:todo@50"]);
    expect(pagesOf(server.rowRequests(), "in_progress")).toEqual(["status:in_progress@0"]);
  }, 60_000);
});
