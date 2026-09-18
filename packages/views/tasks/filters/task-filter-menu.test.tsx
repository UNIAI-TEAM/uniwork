import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { wrap } from "../../test/api-mock";
import { TaskDisplayControls } from "../views/task-display-controls";

initI18n();

const publicConfigState = vi.hoisted(() => ({
  data: {
    flags: {} as Record<string, boolean>,
    rum_sample_rate: 0,
    work_management_capabilities: {
      "tasks.squads": {
        status: "unavailable" as "available" | "unavailable",
        reason_code: "squad_directory_missing",
        explanation_key: "capabilities.squad_directory_missing",
      },
    } as Record<
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

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTaskStatuses: () => ({
      data: {
        statuses: [
          {
            id: "s-todo",
            organization_id: "o1",
            workspace_id: "w1",
            key: "todo",
            name: "Cần làm",
            description: "",
            category: "todo",
            color: "#3b82f6",
            is_system: true,
            position: 1,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        categories: [],
        total: 1,
      },
      isLoading: false,
    }),
    useTaskProperties: () => ({
      data: { properties: [], total: 0 },
      isLoading: false,
    }),
    useTaskLabels: () => ({
      data: { labels: [], total: 0 },
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

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  avatar_url: "",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function renderControls(storeKey: string) {
  const store = getTaskSurfaceViewStore(storeKey);
  render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ViewStoreProvider store={store}>
          <TaskDisplayControls modes={["board", "list"]} />
        </ViewStoreProvider>
      </WorkspaceProvider>,
    ),
  );
  return store;
}

async function openFilterMenu() {
  const add = screen.getByTestId("task-filter-add");
  expect(add).not.toHaveAttribute("data-reason-code", "filters_not_wired");
  expect(add).not.toBeDisabled();
  fireEvent.click(add);
  await waitFor(() => {
    expect(screen.getByTestId("task-filter-section-status")).toBeInTheDocument();
  });
}

async function openSubmenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerMove(trigger);
  fireEvent.mouseEnter(trigger);
  fireEvent.click(trigger);
}

describe("TaskFilterMenu", () => {
  beforeEach(() => {
    publicConfigState.data.work_management_capabilities["tasks.squads"] = {
      status: "unavailable",
      reason_code: "squad_directory_missing",
      explanation_key: "capabilities.squad_directory_missing",
    };
  });

  it("enables Add filter and lists status options from the store", async () => {
    const store = renderControls("test-filter-menu-status");

    await openFilterMenu();
    await openSubmenu("task-filter-section-status");

    const todo = await screen.findByTestId("task-filter-status-todo");
    expect(todo).toBeInTheDocument();
    expect(screen.queryByTestId("task-filter-add")).not.toHaveAttribute(
      "data-reason-code",
      "filters_not_wired",
    );

    fireEvent.click(todo);
    expect(store.getState().statusFilters).toContain("todo");
  });

  it("disables squad assignee row when tasks.squads is unavailable", async () => {
    renderControls("test-filter-menu-squads");

    await openFilterMenu();
    await openSubmenu("task-filter-section-assignee");

    const squadRow = await screen.findByTestId(
      "task-filter-squads-unavailable",
    );
    expect(squadRow).toHaveAttribute(
      "data-reason-code",
      "squad_directory_missing",
    );
    expect(squadRow).toHaveAttribute("aria-disabled", "true");
  });
});
