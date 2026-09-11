import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { resetProjectViewStoreForTests } from "@uniwork/core/projects/stores/view-store";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ProjectsListPage } from "./projects-list-page";

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
  description: "",
  icon: null,
  status: "in_progress",
  priority: "high",
  lead_type: null,
  lead_id: null,
  start_date: null,
  due_date: null,
  revision: 1,
  task_count: 3,
  done_count: 1,
  resource_count: 0,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  resetProjectViewStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.includes("/projects") && !p.includes("/resources")) {
      return Promise.resolve({ projects: [project], total: 1 });
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
    if (p.includes("/pins")) {
      return Promise.resolve({ pins: [], total: 0 });
    }
    return Promise.resolve({});
  });
});

describe("ProjectsListPage", () => {
  it("shows project title from listProjects mock", async () => {
    const onOpenProject = vi.fn();
    render(
      wrapWithNav(
        <ProjectsListPage workspaceId="w1" onOpenProject={onOpenProject} />,
      ),
    );

    expect(await screen.findByText("Q3 launch")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        requestMock.mock.calls.some(([path]) =>
          String(path).includes("/workspaces/w1/projects"),
        ),
      ).toBe(true);
    });
  });
});
