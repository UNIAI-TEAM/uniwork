import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Task, TaskLabel, User, Workspace } from "@uniwork/core/types";
import { toast } from "sonner";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailPropertiesSidebar } from "./properties-sidebar";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const putMutate = vi.hoisted(() => vi.fn());
const updateMutate = vi.hoisted(() => vi.fn());
const attachMutateAsync = vi.hoisted(() => vi.fn());
const detachMutateAsync = vi.hoisted(() => vi.fn());
const projectState = vi.hoisted(() => ({ available: false }));
const labelState = vi.hoisted(() => ({
  catalog: [] as TaskLabel[],
  attached: [] as TaskLabel[],
}));

function makeLabel(id: string, name: string, color: string): TaskLabel {
  return {
    id,
    organization_id: "o1",
    workspace_id: "w1",
    name,
    description: "",
    color,
    usage_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    usePutTask: () => ({ mutate: putMutate, isPending: false }),
    useUpdateTask: () => ({ mutate: updateMutate, isPending: false }),
    useTaskProperties: () => ({
      data: { properties: [], total: 0 },
      isLoading: false,
      isError: false,
    }),
    useTaskLabels: () => ({
      data: { labels: labelState.catalog, total: labelState.catalog.length },
      isLoading: false,
    }),
    useLabelsOnTask: () => ({
      data: { labels: labelState.attached, total: labelState.attached.length },
      isLoading: false,
    }),
    useAttachTaskLabel: () => ({ mutateAsync: attachMutateAsync, isPending: false }),
    useDetachTaskLabel: () => ({ mutateAsync: detachMutateAsync, isPending: false }),
    useTaskStatuses: () => ({
      data: { statuses: [], categories: [], total: 0 },
      isLoading: false,
    }),
    useProjects: () => ({
      data: {
        projects: projectState.available
          ? [
              {
                id: "p1",
                organization_id: "o1",
                workspace_id: "w1",
                title: "Apollo",
                description: "",
                status: "active",
                priority: "medium",
                progress: 0,
                revision: 1,
                created_by: "u1",
                created_at: "2026-09-01T00:00:00Z",
                updated_at: "2026-09-01T00:00:00Z",
              },
            ]
          : [],
        total: projectState.available ? 1 : 0,
      },
      isLoading: false,
    }),
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
        "tasks.projects": projectState.available
          ? { status: "available" }
          : {
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
  updateMutate.mockReset();
  attachMutateAsync.mockReset().mockResolvedValue(undefined);
  detachMutateAsync.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.error).mockReset();
  labelState.catalog = [];
  labelState.attached = [];
  projectState.available = false;
});

function renderSidebar() {
  render(
    shell(
      <TaskDetailPropertiesSidebar workspaceId="w1" task={task} onRefetch={() => {}} />,
    ),
  );
}

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

  it("names each picker by its field and the value it shows", () => {
    renderSidebar();
    for (const field of ["Trạng thái", "Độ ưu tiên", "Người phụ trách"]) {
      const trigger = screen.getByRole(field === "Người phụ trách" ? "combobox" : "button", {
        name: new RegExp(`^${field}: `),
      });
      const visible = trigger.textContent?.trim() ?? "";
      expect(visible).not.toBe("");
      expect(trigger).toHaveAccessibleName(`${field}: ${visible}`);
    }
  });

  it("unassigning sends the id and its kind together (ADR 0007)", async () => {
    render(
      shell(
        <TaskDetailPropertiesSidebar
          workspaceId="w1"
          task={{
            ...task,
            assignee_id: "u1",
            assignee_kind: "human",
            assignee: { kind: "human", id: "u1", display_name: "Me" },
          }}
          onRefetch={() => {}}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Người phụ trách: Me" }));
    const list = await screen.findByRole("listbox");
    fireEvent.click(within(list).getByText("Chưa giao"));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({
      taskId: "t1",
      patch: { assignee_id: null, assignee_kind: "human" },
    });
  });

  it("hiện tên dự án và đổi dự án bằng picker thay vì lộ id", async () => {
    projectState.available = true;
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: /dự án: không có dự án/i }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Apollo" }));

    await waitFor(() =>
      expect(updateMutate).toHaveBeenCalledWith(
        { taskId: "t1", patch: { project_id: "p1" } },
        expect.any(Object),
      ),
    );
    expect(screen.queryByText("p1")).not.toBeInTheDocument();
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

    fireEvent.click(
      screen.getByRole("button", { name: /thêm thuộc tính|add properties/i }),
    );
    const custom = screen.getByTestId("task-detail-custom-properties");
    expect(custom).toHaveAttribute("aria-disabled", "true");
    expect(custom).toHaveAttribute(
      "title",
      expect.stringMatching(/chưa sẵn sàng|not available|surface/i),
    );
  });

  describe("nhãn", () => {
    const bug = makeLabel("l1", "Bug", "#ef4444");
    const frontend = makeLabel("l2", "Frontend", "#3b82f6");

    it("chip nhãn có màu và nút gỡ nói rõ là gỡ nhãn nào", async () => {
      labelState.catalog = [bug, frontend];
      labelState.attached = [bug];
      renderSidebar();
      expect(screen.getByText("Bug").closest("li")?.className).toMatch(/bg-tint-red/);
      fireEvent.click(screen.getByRole("button", { name: /gỡ nhãn bug|remove label bug/i }));
      await waitFor(() => expect(detachMutateAsync).toHaveBeenCalledWith("l1"));
    });

    it("gắn nhãn bằng một cú bấm trong menu, không còn bước chọn rồi bấm Gắn", async () => {
      labelState.catalog = [bug, frontend];
      labelState.attached = [bug];
      renderSidebar();
      expect(screen.queryByRole("button", { name: /^(gắn|attach)$/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /thêm nhãn|add a label/i }));
      fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Frontend" }));
      await waitFor(() => expect(attachMutateAsync).toHaveBeenCalledWith("l2"));
    });

    it("gỡ bằng chip thất bại thì hiện toast lỗi", async () => {
      labelState.catalog = [bug];
      labelState.attached = [bug];
      detachMutateAsync.mockRejectedValue(new Error("boom"));
      renderSidebar();
      fireEvent.click(screen.getByRole("button", { name: /gỡ nhãn bug|remove label bug/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    });
  });
});
