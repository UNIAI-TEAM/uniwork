import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { TaskDetailSuitePage } from "./task-detail-suite-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
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

const task = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "w1",
  number: 12,
  identifier: "TEAM-12",
  revision: 3,
  title: "Ship detail shell",
  description: "TipTap title and body",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
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
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p === "/api/v1/tasks/t1") {
      return Promise.resolve({ task });
    }
    return Promise.resolve({});
  });
});

describe("TaskDetailSuitePage", () => {
  it("renders title region and properties sidebar landmark", async () => {
    render(
      shell(
        <TaskDetailSuitePage workspaceId="w1" taskId="t1" />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("Ship detail shell")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("region", { name: /tiêu đề|title/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: /thuộc tính|properties/i }),
    ).toBeInTheDocument();

    const sidebarToggle = screen.getByRole("button", {
      name: /hiện hoặc ẩn thuộc tính|show or hide properties/i,
    });
    expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(sidebarToggle);
    await waitFor(() => {
      expect(sidebarToggle).toHaveAttribute("aria-expanded", "false");
    });
  });
});
