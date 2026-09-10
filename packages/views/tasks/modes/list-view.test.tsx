import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { ChildProgress, Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
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
  it("groups rows by status and collapses a section", async () => {
    const user = userEvent.setup();
    const { store } = renderList();

    expect(screen.getByTestId("list-group-todo")).toHaveTextContent("Suite row");
    expect(screen.getByTestId("list-group-backlog")).toHaveTextContent(
      "Chưa có task",
    );

    await user.click(screen.getByRole("button", { name: /Cần làm/ }));

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

  it("opens the task from its row action", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: /Suite row/ }));
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  it("does not mount agent trigger or squad assign chrome", () => {
    renderList();
    expect(screen.queryByTestId("list-agent-trigger")).toBeNull();
    expect(screen.queryByTestId("list-squad-assign")).toBeNull();
  });
});
