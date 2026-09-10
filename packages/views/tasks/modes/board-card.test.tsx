import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { BoardCardContent } from "./board-card";

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
  description: "Kiểm tra luồng thanh toán và thông báo lỗi.",
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
  it("renders available task properties with clear visual hierarchy", () => {
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
    expect(screen.getByText("Cao")).toBeInTheDocument();
    expect(screen.getByText(task.description)).toBeInTheDocument();
    expect(screen.getByText("Website bán hàng")).toBeInTheDocument();
    expect(screen.getByText("Nguyễn An")).toBeInTheDocument();
    expect(screen.getByText("2026-09-09 – 2026-09-12")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
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

    expect(screen.queryByText(task.description)).toBeNull();
    expect(screen.queryByText("Nguyễn An")).toBeNull();
    expect(screen.queryByText(/2026-09-12/)).toBeNull();
  });
});
