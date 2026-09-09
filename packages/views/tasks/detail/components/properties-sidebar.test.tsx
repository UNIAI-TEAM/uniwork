import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Task, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailPropertiesSidebar } from "./properties-sidebar";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const putMutate = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    usePutTask: () => ({ mutate: putMutate, isPending: false }),
    useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
    useTaskProperties: () => ({
      data: { properties: [], total: 0 },
      isLoading: false,
      isError: false,
    }),
    useTaskLabels: () => ({
      data: { labels: [], total: 0 },
      isLoading: false,
    }),
    useLabelsOnTask: () => ({
      data: { labels: [], total: 0 },
      isLoading: false,
    }),
    useAttachTaskLabel: () => ({ mutate: vi.fn(), isPending: false }),
    useDetachTaskLabel: () => ({ mutate: vi.fn(), isPending: false }),
    useTaskStatuses: () => ({
      data: { statuses: [], categories: [], total: 0 },
      isLoading: false,
    }),
    useProjects: () => ({ data: { projects: [], total: 0 }, isLoading: false }),
  };
});

vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({ data: [], isLoading: false }),
}));

vi.mock("@uniwork/core/agents", () => ({
  useWorkspaceAgents: () => ({ data: [], isLoading: false }),
}));

vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({
    data: {
      flags: {},
      rum_sample_rate: 0,
      work_management_capabilities: {
        "tasks.projects": {
          status: "unavailable",
          reason_code: "surface_not_ready",
          explanation_key: "capabilities.surface_not_ready",
        },
      },
    },
  }),
}));

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
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
  organization_slug: "org",
  organization_name: "Org",
};

const task: Task = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "w1",
  number: 12,
  identifier: "TEAM-12",
  revision: 3,
  title: "Ship detail shell",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  assignee_kind: "human",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function shell(ui: React.ReactElement) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  putMutate.mockReset();
});

describe("TaskDetailPropertiesSidebar", () => {
  it("changing status calls putTask mutation with revision", async () => {
    render(
      shell(
        <TaskDetailPropertiesSidebar
          workspaceId="w1"
          task={task}
          onRefetch={() => {}}
        />,
      ),
    );

    const status = screen.getByLabelText(/trạng thái|status/i);
    fireEvent.click(status);

    const option = await screen.findByRole("menuitemradio", {
      name: /đang làm|in progress/i,
    });
    fireEvent.click(option);

    await waitFor(() => {
      expect(putMutate).toHaveBeenCalled();
    });

    expect(putMutate.mock.calls[0]?.[0]).toMatchObject({
      taskId: "t1",
      body: { status: "in_progress", revision: 3 },
      ifMatch: "3",
    });
  });

  it("disables custom properties when the catalog is empty", () => {
    render(
      shell(
        <TaskDetailPropertiesSidebar
          workspaceId="w1"
          task={task}
          onRefetch={() => {}}
        />,
      ),
    );

    const custom = screen.getByTestId("task-detail-custom-properties");
    expect(custom).toHaveAttribute("aria-disabled", "true");
    expect(custom).toHaveAttribute(
      "title",
      expect.stringMatching(/chưa sẵn sàng|not available|surface/i),
    );
  });
});
