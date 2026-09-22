import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { BoardCardContent } from "./board-card";
import { BoardView } from "./board-view";

initI18n();

vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({ data: undefined }),
}));

const task: Task = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "w1",
  number: 12,
  identifier: "SAT-12",
  revision: 1,
  title: "Hoàn thiện trang thanh toán",
  description: "**Kiểm tra** [luồng thanh toán](https://example.com)\n\nvà thông báo lỗi.",
  status: "in_progress",
  priority: "high",
  assignee_id: "u1",
  assignee_kind: "human",
  assignee: {
    id: "u1",
    kind: "human",
    display_name: "Nguyễn An",
  },
  start_date: "2026-09-09",
  due_date: "2026-09-12",
  project_id: "p1",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-08T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
};

describe("BoardCardContent", () => {
  it("renders Multica-parity card hierarchy without raw markdown or an always-on footer", () => {
    const store = getTaskSurfaceViewStore("board-card-rich-properties");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardCardContent
            task={task}
            meta={{
              projectName: "Website bán hàng",
              childProgress: { parent_task_id: "t1", done: 2, total: 3 },
            }}
          />
        </ViewStoreProvider>,
      ),
    );

    expect(screen.getByText("SAT-12")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cao" })).toBeInTheDocument();
    expect(screen.queryByText("Cao")).toBeNull();
    expect(screen.getByText("Kiểm tra luồng thanh toán và thông báo lỗi.")).toBeInTheDocument();
    expect(screen.queryByText(task.description)).toBeNull();
    expect(screen.getByText("Website bán hàng").parentElement).toHaveClass("rounded-full");
    expect(screen.getByText("Nguyễn An")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-09 – 2026-09-12")).toBeNull();
    expect(screen.queryByText("2026-09-10")).toBeNull();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="task-progress-ring"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="task-card-meta"]')).not.toHaveClass("border-t");
    expect(screen.queryByText("VCS")).toBeNull();
  });

  it("honors card property visibility settings", () => {
    const store = getTaskSurfaceViewStore("board-card-property-visibility");
    store.getState().toggleCardProperty("description");
    store.getState().toggleCardProperty("assignee");
    store.getState().toggleCardProperty("dueDate");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardCardContent task={task} />
        </ViewStoreProvider>,
      ),
    );

    expect(screen.queryByText("Kiểm tra luồng thanh toán và thông báo lỗi.")).toBeNull();
    expect(screen.queryByText("Nguyễn An")).toBeNull();
    expect(screen.queryByText(/2026-09-12/)).toBeNull();
  });
});

describe("Kanban three-dot button and the priority label", () => {
  // The button sits absolute in the card's top-right corner and is always
  // visible on coarse pointers, where it would cover PriorityFlag withLabel.
  const RESERVE = "pointer-coarse:pr-10";

  it("reserves header space on coarse pointers on the draggable card, which has the button", () => {
    const store = getTaskSurfaceViewStore("board-card-reserve-draggable");
    const { container } = render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardView categories={["in_progress"]} tasks={[task]} onOpenTask={vi.fn()} />
        </ViewStoreProvider>,
      ),
    );

    expect(screen.getByRole("button", { name: "Thêm thao tác" })).toBeInTheDocument();
    const header = container.querySelector("[data-board-card] [data-card-header]");
    expect(header).not.toBeNull();
    expect(header!.className).toContain(RESERVE);
  });

  it("does not reserve space on the drag overlay content, which has no button", () => {
    const store = getTaskSurfaceViewStore("board-card-reserve-overlay");
    const { container } = render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardCardContent task={task} />
        </ViewStoreProvider>,
      ),
    );

    const header = container.querySelector("[data-card-header]");
    expect(header).not.toBeNull();
    expect(header!.className).not.toContain(RESERVE);
  });
});

describe("Kanban column chrome", () => {
  it("uses a quiet heading and a subtle status background", () => {
    const store = getTaskSurfaceViewStore("board-column-multica-chrome");
    const { container } = render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardView categories={["in_progress"]} tasks={[task]} onOpenTask={vi.fn()} />
        </ViewStoreProvider>,
      ),
    );

    expect(container.querySelector('[data-slot="status-pill"]')).toBeNull();
    expect(container.querySelector('[data-slot="status-heading"]')).not.toBeNull();
    expect(screen.getByTestId("board-column-in_progress")).toHaveClass("bg-warning/5");
  });
});
