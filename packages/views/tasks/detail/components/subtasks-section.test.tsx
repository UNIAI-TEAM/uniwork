import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailSubtasksSection } from "./subtasks-section";

const createMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "child-1",
    title: "Child task",
    status: "todo",
    priority: "medium",
    position: 1,
    workspace_id: "w1",
    created_by: "u1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    description: "",
  }),
);
const setParentMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTaskChildren: () => ({
      data: [
        {
          id: "c1",
          title: "Existing child",
          status: "done",
          priority: "medium",
          position: 1,
          workspace_id: "w1",
          identifier: "TEAM-2",
          created_by: "u1",
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
          description: "",
        },
      ],
      isLoading: false,
    }),
    useChildTaskProgress: () => ({
      data: [{ parent_task_id: "t1", total: 1, done: 1 }],
      isLoading: false,
    }),
    useCreateTask: () => ({
      mutateAsync: createMutateAsync,
      isPending: false,
    }),
    useSetTaskParent: () => ({
      mutateAsync: setParentMutateAsync,
      isPending: false,
    }),
  };
});

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
  createMutateAsync.mockClear();
  setParentMutateAsync.mockClear();
});

describe("TaskDetailSubtasksSection", () => {
  it("lists children with progress and creates a child awaiting the server", async () => {
    render(
      shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />),
    );

    expect(screen.getByText("Existing child")).toBeInTheDocument();
    expect(screen.getByTestId("subtasks-progress")).toHaveTextContent("1/1");

    const input = screen.getByLabelText(/thêm sub-task|add sub-task/i);
    fireEvent.change(input, { target: { value: "New child" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ title: "New child" }),
      );
    });
    await waitFor(() => {
      expect(setParentMutateAsync).toHaveBeenCalledWith({
        taskId: "child-1",
        body: { parent_task_id: "t1" },
      });
    });
  });
});
