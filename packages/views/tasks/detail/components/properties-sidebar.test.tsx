import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type {
  Task,
  TaskLabel,
  TaskProperty,
  User,
  Workspace,
} from "@uniwork/core/types";
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
const setPropertyMutate = vi.hoisted(() => vi.fn());
const unsetPropertyMutate = vi.hoisted(() => vi.fn());
const setParentMutate = vi.hoisted(() => vi.fn());
const projectState = vi.hoisted(() => ({ available: false }));
const propertyState = vi.hoisted(() => ({ catalog: [] as TaskProperty[] }));
const parentState = vi.hoisted(() => ({ task: null as Task | null }));
const labelState = vi.hoisted(() => ({
  catalog: [] as TaskLabel[],
  attached: [] as TaskLabel[],
}));
const memberState = vi.hoisted(() => ({
  members: [] as Array<{
    workspace_id: string;
    user_id: string;
    role: "member";
    email: string;
    display_name: string;
    avatar_url?: string;
  }>,
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

function makeProperty(id: string, name: string, type: string): TaskProperty {
  return {
    id,
    organization_id: "o1",
    workspace_id: "w1",
    name,
    description: "",
    type,
    config: {},
    position: 0,
    usage_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  } as TaskProperty;
}

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    usePutTask: () => ({ mutate: putMutate, isPending: false }),
    useUpdateTask: () => ({ mutate: updateMutate, isPending: false }),
    useSetTaskPropertyValue: () => ({ mutate: setPropertyMutate, isPending: false }),
    useUnsetTaskPropertyValue: () => ({ mutate: unsetPropertyMutate, isPending: false }),
    useSetTaskParent: () => ({ mutate: setParentMutate, isPending: false }),
    useTask: (id: string) => ({
      data: parentState.task && parentState.task.id === id ? parentState.task : undefined,
      isLoading: false,
    }),
    useTaskProperties: () => ({
      data: { properties: propertyState.catalog, total: propertyState.catalog.length },
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
  useMembers: () => ({ data: memberState.members, isLoading: false }),
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
  setPropertyMutate.mockReset();
  unsetPropertyMutate.mockReset();
  setParentMutate.mockReset();
  propertyState.catalog = [];
  parentState.task = null;
  attachMutateAsync.mockReset().mockResolvedValue(undefined);
  detachMutateAsync.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.error).mockReset();
  labelState.catalog = [];
  labelState.attached = [];
  projectState.available = false;
  memberState.members = [];
});

function renderSidebar(overrides: Partial<Task> = {}) {
  render(
    shell(
      <TaskDetailPropertiesSidebar
        workspaceId="w1"
        task={{ ...task, ...overrides }}
        onRefetch={() => {}}
      />,
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

    const option = await screen.findByRole("button", {
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
      const trigger = screen.getByRole("button", {
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

    fireEvent.click(screen.getByRole("button", { name: "Người phụ trách: Me" }));
    fireEvent.click(await screen.findByRole("button", { name: "Chưa giao" }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({
      taskId: "t1",
      patch: { assignee_id: null, assignee_kind: "human" },
    });
  });

  it("uses current account avatars for the assignee and creator", () => {
    memberState.members = [
      {
        workspace_id: "w1",
        user_id: "u1",
        role: "member",
        email: "creator@example.com",
        display_name: "Creator",
        avatar_url: "/uploads/avatars/creator.png",
      },
      {
        workspace_id: "w1",
        user_id: "u2",
        role: "member",
        email: "assignee@example.com",
        display_name: "Assignee",
        avatar_url: "/uploads/avatars/assignee.png",
      },
    ];

    render(
      shell(
        <TaskDetailPropertiesSidebar
          workspaceId="w1"
          task={{
            ...task,
            assignee_id: "u2",
            assignee_kind: "human",
            assignee: {
              kind: "human",
              id: "u2",
              display_name: "Stale name",
              avatar_url: "/uploads/avatars/stale.png",
            },
          }}
          onRefetch={() => {}}
        />,
      ),
    );

    expect(screen.getByRole("img", { name: "Assignee" })).toHaveAttribute(
      "src",
      "/uploads/avatars/assignee.png",
    );
    expect(screen.getByRole("img", { name: "Creator" })).toHaveAttribute(
      "src",
      "/uploads/avatars/creator.png",
    );
    expect(screen.queryByText("Stale name")).not.toBeInTheDocument();
  });

  it("hiện tên dự án và đổi dự án bằng picker có tìm kiếm thay vì lộ id", async () => {
    projectState.available = true;
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: /dự án: không có dự án/i }));
    expect(await screen.findByRole("textbox", { name: "Tìm dự án" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apollo" }));

    await waitFor(() =>
      expect(updateMutate).toHaveBeenCalledWith(
        { taskId: "t1", patch: { project_id: "p1" } },
        expect.any(Object),
      ),
    );
    expect(screen.queryByText("p1")).not.toBeInTheDocument();
  });

  it("mỗi mục có tiêu đề thu gọn được", () => {
    renderSidebar();
    const properties = screen.getByRole("button", { name: "Thuộc tính" });
    expect(properties).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Chi tiết" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(properties);
    expect(properties).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Trạng thái: / })).not.toBeInTheDocument();
  });

  it("ẩn độ ưu tiên khi chưa đặt; menu thêm chỉ thêm đúng trường được chọn", async () => {
    renderSidebar({ priority: "none" });
    expect(screen.queryByRole("button", { name: /^Độ ưu tiên: / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ngày bắt đầu: / })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thêm thuộc tính" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Độ ưu tiên",
      "Ngày bắt đầu",
      "Hạn",
      "Nhãn",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ngày bắt đầu" }));

    expect(await screen.findByRole("button", { name: /^Ngày bắt đầu: / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hạn: / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Độ ưu tiên: / })).not.toBeInTheDocument();
    expect(await screen.findByText("Bỏ chọn ngày")).toBeInTheDocument();
  });

  it("sửa được ngày bắt đầu và gửi qua patch", async () => {
    renderSidebar({ start_date: "2026-09-06" });
    const trigger = screen.getByRole("button", { name: /^Ngày bắt đầu: / });
    expect(trigger).not.toHaveAttribute("aria-disabled");
    expect(trigger).toBeEnabled();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("Bỏ chọn ngày"));
    expect(updateMutate).toHaveBeenCalledWith(
      { taskId: "t1", patch: { start_date: null } },
      expect.any(Object),
    );
  });

  it("hạn là nút gọn có icon, quá hạn thì tô đỏ", () => {
    renderSidebar({ due_date: "2020-01-02" });
    const trigger = screen.getByRole("button", { name: /^Hạn: / });
    expect(trigger.className).not.toMatch(/border-input/);
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(trigger.querySelector(".text-destructive")).not.toBeNull();
  });

  it("chi tiết hiện ngày ngắn, không kèm giờ", () => {
    renderSidebar();
    const details = screen.getByRole("button", { name: "Chi tiết" }).closest("section");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getAllByText(/^1 thg 9/)).toHaveLength(2);
    expect(details?.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  describe("thuộc tính tùy chỉnh", () => {
    const points = makeProperty("cp1", "Story points", "number");
    const note = makeProperty("cp2", "Ghi chú", "text");

    it("mỗi thuộc tính đã có giá trị là một hàng sửa được", () => {
      propertyState.catalog = [points, note];
      renderSidebar({ properties: { cp1: 3 } });
      expect(screen.queryByText("Ghi chú")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Story points: 3" }));
      const input = screen.getByRole("textbox", { name: "Story points: 3" });
      fireEvent.change(input, { target: { value: "5" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(setPropertyMutate).toHaveBeenCalledWith(
        { taskId: "t1", propertyId: "cp1", value: 5 },
        expect.any(Object),
      );
    });

    it("thuộc tính chưa có giá trị được thêm từ menu", async () => {
      propertyState.catalog = [points];
      renderSidebar();
      expect(screen.queryByText("Story points")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Thêm thuộc tính" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Story points" }));

      expect(
        await screen.findByRole("button", { name: /^Story points: / }),
      ).toBeInTheDocument();
    });
  });

  describe("công việc cha", () => {
    it("không có cha thì không hiện mục công việc cha", () => {
      renderSidebar();
      expect(screen.queryByRole("button", { name: "Công việc cha" })).not.toBeInTheDocument();
      expect(screen.queryByText("Thêm công việc cha")).not.toBeInTheDocument();
    });

    it("có cha thì hiện dòng liên kết và gỡ được", () => {
      parentState.task = { ...task, id: "t0", identifier: "TEAM-1", title: "Epic" };
      renderSidebar({ parent_task_id: "t0" });

      expect(screen.getByRole("button", { name: "Công việc cha" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByRole("link", { name: /TEAM-1.*Epic/ })).toHaveAttribute(
        "href",
        expect.stringContaining("/tasks/t0"),
      );
      fireEvent.click(screen.getByRole("button", { name: "Bỏ công việc cha" }));
      expect(setParentMutate).toHaveBeenCalledWith(
        { taskId: "t1", body: { parent_task_id: null } },
        expect.any(Object),
      );
    });
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
