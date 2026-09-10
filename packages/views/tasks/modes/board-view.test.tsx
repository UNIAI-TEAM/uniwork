import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { TASK_STATUSES, type Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { BoardView } from "./board-view";

initI18n();

const publicConfigState = vi.hoisted(() => ({
  data: {
    flags: {} as Record<string, boolean>,
    rum_sample_rate: 0,
    work_management_capabilities: {} as Record<
      string,
      {
        status: "available" | "unavailable";
        reason_code: string;
        explanation_key: string;
      }
    >,
  },
}));

vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({ data: publicConfigState.data }),
}));

const sample: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "Suite card",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_kind: "human",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

beforeEach(() => {
  publicConfigState.data = {
    flags: {},
    rum_sample_rate: 0,
    work_management_capabilities: {
      "tasks.agent_runs": {
        status: "unavailable",
        reason_code: "agent_runtime_missing",
        explanation_key: "capabilities.agent_runtime_missing",
      },
      "tasks.squads": {
        status: "unavailable",
        reason_code: "squad_directory_missing",
        explanation_key: "capabilities.squad_directory_missing",
      },
    },
  };
});

describe("modes/BoardView", () => {
  it("renders backlog through cancelled columns from catalog", async () => {
    const store = getTaskSurfaceViewStore("board-view-test");
    render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardView
            categories={[...TASK_STATUSES]}
            tasks={[sample]}
          />
        </ViewStoreProvider>,
      ),
    );

    for (const category of TASK_STATUSES) {
      expect(
        await screen.findByTestId(`board-column-${category}`),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^board-column-/)).toHaveLength(7);
    expect(screen.getByText("Suite card")).toBeInTheDocument();
    // MVP board only had four columns — suite must include catalog extremes.
    expect(screen.getByTestId("board-column-backlog")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-in_review")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-blocked")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nhóm theo dự án" }),
    ).toBeNull();
  });

  it("does not mount board agent trigger or squad assign chrome", async () => {
    const store = getTaskSurfaceViewStore("board-view-gates");
    render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardView
            categories={[...TASK_STATUSES]}
            tasks={[sample]}
          />
        </ViewStoreProvider>,
      ),
    );

    expect(await screen.findByText("Suite card")).toBeInTheDocument();
    expect(screen.queryByTestId("board-agent-trigger")).toBeNull();
    expect(screen.queryByTestId("board-squad-assign")).toBeNull();
  });

  it("rebuilds columns when grouping by assignee", async () => {
    const store = getTaskSurfaceViewStore("board-view-assignee-grouping");
    store.getState().setGrouping("assignee");
    const assigned = {
      ...sample,
      assignee_id: "u2",
      assignee: {
        kind: "human" as const,
        id: "u2",
        display_name: "Bình",
      },
    };
    const unassigned = { ...sample, id: "t2", title: "No owner" };

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <BoardView
            categories={[...TASK_STATUSES]}
            tasks={[assigned, unassigned]}
          />
        </ViewStoreProvider>,
      ),
    );

    const assignedColumn = await screen.findByTestId(
      "board-column-assignee:human:u2",
    );
    expect(assignedColumn).toBeInTheDocument();
    expect(screen.getByTitle("Bình")).toHaveTextContent("Bình");
    expect(screen.getByTitle("Chưa giao")).toHaveTextContent("Chưa giao");
    expect(screen.queryByTestId("board-column-todo")).toBeNull();
  });
});
