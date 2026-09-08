import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { TASK_STATUSES, type Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { SwimLaneView } from "./swimlane-view";

initI18n();

const sample = (over: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    organization_id: "",
    workspace_id: "w1",
    number: 1,
    identifier: "T-1",
    revision: 1,
    title: "Lane card",
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
    ...over,
  }) as Task;

describe("modes/SwimLaneView", () => {
  it("renders assignee lanes including the unassigned pinned lane", async () => {
    const store = getTaskSurfaceViewStore("swimlane-view-test");
    store.getState().setSwimlaneGrouping("assignee");
    render(
      wrap(
        <ViewStoreProvider store={store}>
          <SwimLaneView
            categories={[...TASK_STATUSES]}
            tasks={[
              sample({
                id: "a",
                title: "Mine",
                assignee_id: "user-1",
                assignee_kind: "human",
              }),
              sample({ id: "b", title: "Free", status: "in_progress" }),
            ]}
            projectGroupingDisabled
            parentGroupingDisabled
          />
        </ViewStoreProvider>,
      ),
    );

    expect(await screen.findByTestId("swimlane-view")).toBeInTheDocument();
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(
      screen.getByTestId("swimlane-lane-assignee:none"),
    ).toBeInTheDocument();
  });
});
