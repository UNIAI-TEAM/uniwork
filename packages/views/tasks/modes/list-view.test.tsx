import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { ChildProgress, Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import type { TaskSurfacePagination } from "../surface/use-task-surface-data";
import { ListView } from "./list-view";

initI18n();

let renderIndex = 0;

const sample: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "SAT-1",
  revision: 1,
  title: "Suite row",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_id: "u1",
  assignee_kind: "human",
  assignee: { kind: "human", id: "u1", display_name: "Bình" },
  project_id: "p1",
  start_date: "2026-09-06",
  due_date: "2026-09-10",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

function renderList(
  tasks: Task[] = [sample],
  meta?: ReadonlyMap<
    string,
    { projectName?: string; childProgress?: ChildProgress }
  >,
) {
  renderIndex += 1;
  const store = getTaskSurfaceViewStore(`list-view-${renderIndex}`);
  const result = render(
    wrap(
      <ViewStoreProvider store={store}>
        <ListView
          categories={["backlog", "todo", "done"]}
          tasks={tasks}
          cardMeta={meta}
        />
      </ViewStoreProvider>,
    ),
  );
  return { ...result, store };
}

describe("modes/ListView", () => {
  it("groups rows by status and collapses a section", () => {
    const { store } = renderList();

    expect(screen.getByTestId("list-group-todo")).toHaveTextContent("Suite row");
    expect(screen.getByTestId("list-group-backlog")).toHaveTextContent(
      "Chưa có task",
    );

    fireEvent.click(screen.getByRole("button", { name: /Cần làm/ }));

    expect(store.getState().listCollapsedStatuses).toContain("todo");
  });

  it("renders dense row metadata controlled by card properties", () => {
    const meta = new Map([
      [
        sample.id,
        {
          projectName: "Saturn",
          childProgress: { parent_task_id: sample.id, done: 2, total: 3 },
        },
      ],
    ]);
    const { store, rerender } = renderList([sample], meta);

    expect(screen.getByText("SAT-1")).toBeInTheDocument();
    expect(screen.getByText("Saturn")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("Bình")).toBeInTheDocument();

    store.getState().toggleCardProperty("project");
    rerender(
      wrap(
        <ViewStoreProvider store={store}>
          <ListView
            categories={["backlog", "todo", "done"]}
            tasks={[sample]}
            cardMeta={meta}
          />
        </ViewStoreProvider>,
      ),
    );
    expect(screen.queryByText("Saturn")).toBeNull();
  });

  it("opens the task from its row action", () => {
    const onOpenTask = vi.fn();
    renderIndex += 1;
    const store = getTaskSurfaceViewStore(`list-open-${renderIndex}`);
    render(
      wrap(
        <ViewStoreProvider store={store}>
          <ListView
            categories={["todo"]}
            tasks={[sample]}
            onOpenTask={onOpenTask}
          />
        </ViewStoreProvider>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Suite row/ }));
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  it("does not mount agent trigger or squad assign chrome", () => {
    renderList();
    expect(screen.queryByTestId("list-agent-trigger")).toBeNull();
    expect(screen.queryByTestId("list-squad-assign")).toBeNull();
  });
});

// Behaviour against a real paging transport lives in
// surface/task-surface.test.tsx; these cases pin the view's wiring.
describe("modes/ListView pagination", () => {
  const pages = (
    over: Partial<TaskSurfacePagination> = {},
  ): TaskSurfacePagination => ({
    loaded: 1,
    total: 120,
    hasMore: true,
    isLoadingMore: false,
    isLoadMoreError: false,
    loadMore: vi.fn(),
    ...over,
  });

  function renderPagedList(pagination: TaskSurfacePagination) {
    renderIndex += 1;
    const store = getTaskSurfaceViewStore(`list-paged-${renderIndex}`);
    return render(
      wrap(
        <ViewStoreProvider store={store}>
          <ListView
            categories={["backlog", "todo", "done"]}
            tasks={[sample]}
            pagination={pagination}
          />
        </ViewStoreProvider>,
      ),
    );
  }

  beforeEach(() => {
    // The load-more row is the tested path; keep the sentinel out of it.
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ends an under-threshold list with a load-more row that asks for the next page", () => {
    const loadMore = vi.fn();
    renderPagedList(pages({ loadMore }));

    const button = screen.getByRole("button", { name: "Tải thêm" });
    // At the end of the whole list, after the last group, not inside one.
    expect(screen.getByTestId("list-group-done").contains(button)).toBe(false);
    expect(
      screen.getByTestId("list-group-done").compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(button);

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("puts the loaded / total notice above the list and never names a group count as a total", () => {
    renderPagedList(pages());

    const notice = screen.getByText("Đã tải 1 / 120 công việc");
    expect(
      notice.compareDocumentPosition(screen.getByTestId("list-group-backlog")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cần làm, đã tải 1" }),
    ).toBeInTheDocument();
  });

  it("shows neither notice nor load-more row once every task is loaded", () => {
    renderPagedList(pages({ total: 1, hasMore: false }));

    expect(screen.queryByRole("button", { name: "Tải thêm" })).toBeNull();
    expect(screen.queryByText(/Đã tải/)).toBeNull();
    expect(screen.getByRole("button", { name: "Cần làm, 1" })).toBeInTheDocument();
  });
});
