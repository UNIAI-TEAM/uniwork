import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ProjectDetailPage } from "./project-detail-page";

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const project = {
  id: "p1",
  organization_id: "o1",
  workspace_id: "w1",
  title: "Q3 launch",
  description: "Ship projects suite",
  icon: null,
  status: "in_progress",
  priority: "high",
  lead_type: null,
  lead_id: null,
  start_date: null,
  due_date: null,
  revision: 1,
  task_count: 1,
  done_count: 0,
  resource_count: 0,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const taskInProject = {
  id: "t-in",
  workspace_id: "w1",
  project_id: "p1",
  title: "In-project task",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  getTaskSurfaceViewStore("project:p1").getState().setViewMode("list");
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { body?: unknown }) => {
    const p = String(path);
    if (p.match(/\/projects\/p1$/) && !p.includes("/resources")) {
      return Promise.resolve({ project });
    }
    if (p.includes("/projects/p1/resources")) {
      return Promise.resolve({ resources: [], total: 0 });
    }
    if (p.includes("/tasks/query")) {
      const body = (init?.body ?? {}) as { project_id?: string };
      const tasks =
        body.project_id === "p1" ? [taskInProject] : [taskInProject, {
          ...taskInProject,
          id: "t-other",
          project_id: "p2",
          title: "Other-project task",
        }];
      return Promise.resolve({
        tasks,
        total: tasks.length,
        limit: 50,
        offset: 0,
      });
    }
    if (p.includes("/members")) {
      return Promise.resolve({
        members: [
          {
            workspace_id: "w1",
            user_id: "u1",
            role: "admin",
            email: "me@x.com",
            display_name: "Me",
          },
        ],
      });
    }
    if (p.includes("/config") || p.includes("/public-config")) {
      return Promise.resolve({
        flags: {},
        rum_sample_rate: 0,
        work_management_capabilities: {},
      });
    }
    return Promise.resolve({});
  });
});

describe("ProjectDetailPage", () => {
  it("mounts TaskSurface with project scope and query body includes project_id", async () => {
    const onOpenTask = vi.fn();
    const onBack = vi.fn();
    render(
      wrapWithNav(
        <ProjectDetailPage
          workspaceId="w1"
          projectId="p1"
          onOpenTask={onOpenTask}
          onBack={onBack}
        />,
      ),
    );

    expect(await screen.findByDisplayValue("Q3 launch")).toBeInTheDocument();

    await waitFor(() => {
      const queryCall = requestMock.mock.calls.find(
        ([path]) => String(path).includes("/tasks/query"),
      );
      expect(queryCall).toBeDefined();
      const init = queryCall?.[1] as { body?: { project_id?: string } } | undefined;
      expect(init?.body?.project_id).toBe("p1");
    });

    expect(await screen.findByText("In-project task")).toBeInTheDocument();
  });

  it("does not render tasks from other projects when the mock returns a filtered list", async () => {
    render(
      wrapWithNav(
        <ProjectDetailPage
          workspaceId="w1"
          projectId="p1"
          onOpenTask={vi.fn()}
          onBack={vi.fn()}
        />,
      ),
    );

    expect(await screen.findByText("In-project task")).toBeInTheDocument();
    expect(screen.queryByText("Other-project task")).not.toBeInTheDocument();
  });
});
