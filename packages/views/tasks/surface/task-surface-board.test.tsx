import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { planCacheUpdate } from "@uniwork/core/tasks";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import type { TaskScope } from "@uniwork/core/tasks/surface/scope";
import { wrap } from "../../test/api-mock";
import { boardTask, serveBoardTable } from "../../test/board-table-server";
import { TaskSurface } from "./task-surface";
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
  requests.filter((page) => page.startsWith(`${status}@`));
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

  it("loads each column's first page on its own and heads it with the column total, not the cards loaded", async () => {
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3, done: 0 } });
    renderBoard("board-first-pages");

    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);
    expect(cardsIn("in_progress")).toBe(3);
    expect(cardsIn("done")).toBe(0);
    expect(heading("todo", 120)).toBeInTheDocument();
    expect(heading("in_progress", 3)).toBeInTheDocument();
    expect(within(column("done")).getByText(i18n.t("tasks.surface.empty_column"))).toBeInTheDocument();
    expect([...server.rowRequests()].sort()).toEqual(["in_progress@0", "todo@0"]);
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
    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["todo@0", "todo@50"]);
    expect(pagesOf(server.rowRequests(), "in_progress")).toEqual(["in_progress@0"]);

    await clickColumnLoadMore("todo");
    await waitFor(() => expect(cardsIn("todo")).toBe(120), LONG);
    expect(within(column("todo")).getByText("Không còn công việc để tải")).toBeInTheDocument();
    expect(within(column("todo")).queryByRole("button", { name: "Tải thêm" })).toBeNull();
    expect(heading("todo", 120)).toBeInTheDocument();
    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["todo@0", "todo@50", "todo@100"]);
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
    expect(server.rowRequests()).toEqual(["todo@0", "todo@50"]);
    expect(heading("todo", 120)).toBeInTheDocument();
  }, 60_000);

  it("a column load more clicked during a realtime refetch still gets exactly the next page", async () => {
    // The second request for todo's first page is the refetch; hold it so the click lands mid-refetch.
    const server = serveBoardTable({ counts: { todo: 120 }, hold: "todo@0", holdNth: 2 });
    renderBoard("board-refetch-click");
    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);

    fireEvent.click(screen.getByRole("button", { name: "task.updated arrives" }));
    await waitFor(() => expect(server.rowRequests()).toEqual(["todo@0", "todo@0"]), LONG);
    await clickColumnLoadMore("todo");
    await waitFor(() => expect(cardsIn("todo")).toBe(100), LONG);

    server.release();
    await settle(300);
    expect(server.rowRequests()).toEqual(["todo@0", "todo@0", "todo@50"]);
    expect(cardsIn("todo")).toBe(100);
  }, 60_000);

  it("a column whose page fails offers retry in that column and leaves the rest of the board alone", async () => {
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3 }, failOnce: ["todo@0"] });
    renderBoard("board-column-error");

    await waitFor(() => expect(cardsIn("in_progress")).toBe(3), LONG);
    const retry = await within(column("todo")).findByRole("button", { name: "Thử lại" }, LONG);
    expect(within(column("todo")).getByText("Không tải thêm được công việc.")).toBeInTheDocument();
    expect(within(column("todo")).queryByText(i18n.t("tasks.surface.empty_column"))).toBeNull();
    expect(screen.queryByTestId("task-surface-error")).toBeNull();
    expect(within(column("in_progress")).queryByRole("button", { name: "Thử lại" })).toBeNull();

    fireEvent.click(retry);

    await waitFor(() => expect(cardsIn("todo")).toBe(50), LONG);
    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["todo@0", "todo@0"]);
  }, 60_000);

  it("a project board asks the table API for that project's groups and rows only", async () => {
    const server = serveBoardTable({ counts: { todo: 3 } });
    renderBoard("board-project", { type: "project", projectId: "p1" });

    await waitFor(() => expect(cardsIn("todo")).toBe(3), LONG);
    expect(server.groupBodies.length).toBeGreaterThan(0);
    expect(server.rowBodies.length).toBeGreaterThan(0);
    for (const body of [...server.groupBodies, ...server.rowBodies]) {
      expect(body.filter).toEqual({ project_ids: ["p1"] });
    }
  }, 60_000);

  it("a failed groups call is a surface error whose retry asks the table API again", async () => {
    const server = serveBoardTable({ counts: { todo: 3 }, failGroupsOnce: true });
    renderBoard("board-groups-error");

    const error = await screen.findByTestId("task-surface-error", {}, LONG);
    fireEvent.click(within(error).getByRole("button", { name: "Thử lại" }));

    await waitFor(() => expect(cardsIn("todo")).toBe(3), LONG);
    expect(server.groupBodies).toHaveLength(2);
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
    expect([...server.rowRequests().slice(rowsBefore)].sort()).toEqual(["in_progress@0", "todo@0"]);
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
      "in_progress@0",
      "in_progress@50",
      "todo@0",
      "todo@50",
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
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    expect(await screen.findByText("100 / 120 công việc đã tải", {}, LONG)).toBeInTheDocument();
    expect(server.paths.some((path) => path.includes("/tasks/table/"))).toBe(false);
    expect(server.paths.some((path) => path.includes("/tasks/grouped"))).toBe(false);
  }, 60_000);
});

describe("TaskSurface board column sentinel", () => {
  it("loads the next page of a column whose end is on screen once, and not again while it stays there", async () => {
    // Uses the shared setup's observer, which reports every observed node as
    // visible (test/media-stub.ts). The page is held so the column re-renders
    // in its loading state with the footer mounted; a footer remounted on
    // render would observe again and load another page.
    const server = serveBoardTable({ counts: { todo: 120, in_progress: 3 }, hold: "todo@50" });
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

    expect(pagesOf(server.rowRequests(), "todo")).toEqual(["todo@0", "todo@50"]);
    expect(pagesOf(server.rowRequests(), "in_progress")).toEqual(["in_progress@0"]);
  }, 60_000);
});
