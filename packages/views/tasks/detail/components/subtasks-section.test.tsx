import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { useTaskDetailUiStore } from "@uniwork/core/tasks/stores/task-detail-ui-store";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailSubtasksSection } from "./subtasks-section";

const existingChild = {
  id: "c1",
  title: "Existing child",
  status: "done",
  priority: "medium",
  position: 1,
  workspace_id: "w1",
  identifier: "TEAM-2",
  stage: 1,
  due_date: "2026-09-11",
  assignee: {
    id: "u1",
    kind: "human",
    display_name: "Me",
    avatar_url: "/uploads/avatars/me.png",
  },
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  description: "",
};
const children = vi.hoisted(() => ({ current: [] as unknown[] }));
const parentTask = vi.hoisted(() => ({
  current: { id: "t1", project_id: "p1" } as Record<string, unknown> | undefined,
}));
vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTask: () => ({ data: parentTask.current }),
    useTaskChildren: () => ({ data: children.current, isLoading: false }),
    useChildTaskProgress: () => ({
      data: [{ parent_task_id: "t1", total: 1, done: 1 }],
      isLoading: false,
    }),
  };
});

const createDialogProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const dialogMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../create-task-dialog", () => ({
  CreateTaskDialog: (props: Record<string, unknown>) => {
    createDialogProps.current = props;
    useState(() => {
      dialogMounts.count += 1;
      return null;
    });
    return props.open ? <div data-testid="create-task-dialog" /> : null;
  },
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
  children.current = [existingChild];
  parentTask.current = { id: "t1", project_id: "p1" };
  createDialogProps.current = {};
  useTaskDetailUiStore.setState({ tasks: {} });
});

describe("TaskDetailSubtasksSection", () => {
  it("lists children with progress and opens the shared create form under this parent", () => {
    render(
      shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />),
    );

    expect(screen.getByText("Existing child")).toBeInTheDocument();
    expect(screen.getByText("Giai đoạn 1")).toBeInTheDocument();
    expect(screen.getByText(/11.*9|Sep 11/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /người phụ trách.*Me/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Me" })).toHaveAttribute(
      "src",
      "/uploads/avatars/me.png",
    );
    expect(screen.getByTestId("subtasks-progress")).toHaveTextContent("1/1");
    expect(screen.queryByTestId("create-task-dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thêm sub-task" }));

    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Thêm sub-task" })).not.toBeInTheDocument();
    expect(createDialogProps.current).toMatchObject({
      workspaceId: "w1",
      showTrigger: false,
      defaults: { parent_task_id: "t1", project_id: "p1" },
    });

    act(() => (createDialogProps.current.onOpenChange as (open: boolean) => void)(false));
    expect(screen.queryByTestId("create-task-dialog")).not.toBeInTheDocument();
  });

  it("opens the shared create form from the empty state", () => {
    children.current = [];
    parentTask.current = { id: "t1", project_id: null };
    render(shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />));

    fireEvent.click(screen.getByRole("button", { name: "Thêm sub-task" }));

    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(createDialogProps.current.defaults).toEqual({
      parent_task_id: "t1",
      project_id: null,
    });
  });

  it("keeps the open form mounted when the first sub-task arrives (create another)", () => {
    children.current = [];
    const view = render(shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />));
    fireEvent.click(screen.getByRole("button", { name: "Thêm sub-task" }));
    const mountsWhenOpened = dialogMounts.count;

    children.current = [existingChild];
    view.rerender(shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />));

    expect(screen.getByText("Existing child")).toBeInTheDocument();
    expect(screen.getByTestId("create-task-dialog")).toBeInTheDocument();
    expect(dialogMounts.count).toBe(mountsWhenOpened);
  });

  it("leaves the project to the form's own default until the parent has loaded", () => {
    parentTask.current = undefined;
    render(shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />));

    fireEvent.click(screen.getByRole("button", { name: "Thêm sub-task" }));

    expect(createDialogProps.current.defaults).toEqual({ parent_task_id: "t1" });
  });

  it("gấp danh sách sub-task, giữ tiêu đề và tiến độ, và nhớ khi mở lại task", () => {
    const first = render(
      shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />),
    );

    const toggle = screen.getByRole("button", {
      name: "Hiện hoặc ẩn danh sách sub-task",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const regionId = toggle.getAttribute("aria-controls");
    expect(regionId).toBeTruthy();
    const region = document.getElementById(regionId!);
    expect(region).not.toBeNull();
    expect(region).toContainElement(screen.getByText("Existing child"));

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Existing child")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Sub-task" })).toBeVisible();
    expect(screen.getByTestId("subtasks-progress")).toBeVisible();
    first.unmount();

    render(shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />));

    const again = screen.getByRole("button", {
      name: "Hiện hoặc ẩn danh sách sub-task",
    });
    expect(again).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Existing child")).not.toBeVisible();

    fireEvent.click(again);
    expect(again).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Existing child")).toBeVisible();
  });

  it("một task khác không thừa hưởng trạng thái gấp", () => {
    useTaskDetailUiStore.getState().setSubtasksCollapsed("t-other", true);

    render(shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />));

    expect(
      screen.getByRole("button", { name: "Hiện hoặc ẩn danh sách sub-task" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Existing child")).toBeVisible();
  });

  it("giữ người phụ trách và hạn ở cuối hàng, rồi hiện đủ batch actions khi chọn", () => {
    render(
      shell(<TaskDetailSubtasksSection workspaceId="w1" taskId="t1" />),
    );

    expect(screen.getByText(/11.*9|Sep 11/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /người phụ trách.*Me/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Thao tác sub-task" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /TEAM-2/ }),
    );

    expect(screen.getByText("Đã chọn 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bỏ chọn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trạng thái" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Độ ưu tiên" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Người nhận/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hạn" })).toBeInTheDocument();
    expect(screen.getByTestId("batch-delete")).toBeInTheDocument();
  });
});
