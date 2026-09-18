import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { TaskViewState } from "@uniwork/core/tasks/stores/view-store";
import { baselineFromQuery } from "@uniwork/core/tasks/views/baseline";
import { wrap } from "../../test/api-mock";
import { FilterChipsBar } from "./filter-chips-bar";

initI18n();

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTaskLabels: () => ({
      data: {
        labels: [
          {
            id: "label-1",
            organization_id: "o1",
            workspace_id: "w1",
            name: "Bug",
            description: "",
            color: "#ef4444",
            usage_count: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        total: 1,
      },
      isLoading: false,
    }),
    useTaskProperties: () => ({
      data: {
        properties: [
          {
            id: "prop-1",
            organization_id: "o1",
            workspace_id: "w1",
            name: "Severity",
            type: "select",
            description: "",
            config: {
              options: [{ id: "opt-a", name: "High", color: "#f00" }],
            },
            position: 0,
            usage_count: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        total: 1,
      },
      isLoading: false,
    }),
    useProjects: () => ({
      data: { projects: [], total: 0 },
      isLoading: false,
    }),
  };
});

vi.mock("@uniwork/core/workspaces", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@uniwork/core/workspaces")>();
  return {
    ...actual,
    useMembers: () => ({ data: [] }),
  };
});

vi.mock("@uniwork/core/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/agents")>();
  return {
    ...actual,
    useWorkspaceAgents: () => ({ data: [] }),
  };
});

function renderBar(
  storeKey: string,
  props: Omit<ComponentProps<typeof FilterChipsBar>, "workspaceId"> = {},
  // Partial — Parameters<setState>[0] resolves Zustand's replace overload (full state).
  seed?: Partial<TaskViewState>,
) {
  const store = getTaskSurfaceViewStore(storeKey);
  if (seed) store.setState(seed);
  render(
    wrap(
      <ViewStoreProvider store={store}>
        <FilterChipsBar workspaceId="w1" {...props} />
      </ViewStoreProvider>,
    ),
  );
  return store;
}

describe("FilterChipsBar", () => {
  it("shows a chip for an active label filter", () => {
    renderBar("chips-label", {}, { labelFilters: ["label-1"] });

    expect(screen.getByTestId("tasks-filter-chips")).toBeInTheDocument();
    expect(screen.getByText("Nhãn")).toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  it("restores baseline statusFilters when removing the status chip", () => {
    const baseline = baselineFromQuery({
      statusFilters: ["todo"],
      priorityFilters: [],
      assigneeFilters: [],
      includeNoAssignee: false,
      creatorFilters: [],
      projectFilters: [],
      includeNoProject: false,
      labelFilters: [],
      propertyFilters: {},
    });
    const store = renderBar(
      "chips-baseline-status",
      { viewBaseline: baseline },
      { statusFilters: ["todo", "in_progress"] },
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /gỡ bộ lọc trạng thái|remove status filter/i,
      }),
    );

    expect(store.getState().statusFilters).toEqual(["todo"]);
  });

  it("shows a property chip for NO_PROPERTY_VALUE as no-value label", async () => {
    const { NO_PROPERTY_VALUE } = await import("../utils/filter");
    renderBar(
      "chips-property-none",
      {},
      { propertyFilters: { "prop-1": [NO_PROPERTY_VALUE] } },
    );

    expect(screen.getByText("Severity")).toBeInTheDocument();
    expect(screen.getByText(/chưa có giá trị|no value/i)).toBeInTheDocument();
  });
});
