import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { setSessionUser } from "@uniwork/core/auth";
import { useCreateTaskDraftStore } from "@uniwork/core/tasks/stores/create-task-draft-store";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import type { NavigationAdapter } from "../navigation";
import { requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { NewTaskDialog } from "./new-task-dialog";
import { ApiError } from "@uniwork/core/api";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const createdTask = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "ws1",
  number: 1,
  identifier: "UNI-1",
  revision: 1,
  title: "Sửa lỗi",
  description: "Chi tiết",
  status: "in_progress",
  priority: "high",
  assignee_id: "u1",
  assignee_kind: "human",
  due_date: "2026-09-30",
  start_date: "2026-09-20",
  project_id: "p1",
  parent_task_id: null,
  stage: null,
  position: -1024,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-16T00:00:00Z",
  updated_at: "2026-09-16T00:00:00Z",
};

const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

describe("NewTaskDialog", () => {
  beforeEach(() => {
    setSessionUser(user);
    useCreateTaskDraftStore.setState({ drafts: {}, settings: {}, ownerId: null });
    toastSuccess.mockReset();
    toastError.mockReset();
    requestMock.mockReset();
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/organizations") || path.includes("/organizations?")) return { organizations: [] };
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (path.endsWith("/task-properties")) return { properties: [], total: 0 };
      if (path.endsWith("/tasks") && init?.method !== "POST") return { tasks: [] };
      if (init?.method === "POST" && path.endsWith("/tasks")) return { task: createdTask };
      return {};
    });
  });

  it("opens when controlled open=true without rendering a trigger button", () => {
    render(
      wrap(
        <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Việc mới" })).toBeNull();
  });

  it("persists edits without updating the draft store during React render", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <StrictMode>
        {wrap(<NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />)}
      </StrictMode>,
    );

    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Không cảnh báo" } });

    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("Cannot update a component"),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("does not mount agent trigger or squad assign chrome", () => {
    render(
      wrap(
        <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );

    expect(screen.queryByTestId("create-agent-trigger")).toBeNull();
    expect(screen.queryByTestId("create-squad-assign")).toBeNull();
  });

  it("matches the Multica title emphasis and agent-mode affordance", () => {
    render(
      wrap(
        <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );

    expect(screen.getByPlaceholderText("Tiêu đề issue")).toHaveClass(
      "text-title",
      "font-semibold",
      "placeholder:font-semibold",
    );
    expect(screen.getByRole("button", { name: "Chuyển sang agent" })).toHaveClass(
      "border-beam",
      "group",
    );
  });

  it("preserves independent manual and agent drafts plus shared create state across mode switches", async () => {
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/agents")) {
        return {
          agents: [{
            id: "agent-1",
            organization_id: "o1",
            name: "Agent 17",
            handle: "agent-17",
            description: "",
            status: "active",
            owner_user_id: "u1",
          }],
        };
      }
      if (path.endsWith("/projects")) {
        return {
          projects: [{
            id: "p1",
            organization_id: "o1",
            workspace_id: "ws1",
            title: "UniWork",
            description: "",
            status: "in_progress",
            priority: "high",
            revision: 1,
            task_count: 0,
            done_count: 0,
            resource_count: 0,
            created_at: "2026-09-16T00:00:00Z",
            updated_at: "2026-09-16T00:00:00Z",
          }],
          total: 1,
        };
      }
      if (path.endsWith("/task-properties")) return { properties: [], total: 0 };
      if (path.endsWith("/tasks") && init?.method !== "POST") return { tasks: [] };
      return {};
    });
    render(wrap(
      <NewTaskDialog
        workspaceId="ws1"
        open
        showTrigger={false}
        onOpenChange={() => {}}
        defaults={{ project_id: "p1", priority: "high", due_date: "2026-09-30" }}
      />,
    ));

    const manualEditor = await screen.findByRole("textbox", { name: "Mô tả" });
    fireEvent.input(manualEditor, { target: { innerHTML: "<p>Mô tả thủ công</p>" } });
    await waitFor(() =>
      expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.description).toBe("Mô tả thủ công"),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Tạo tiếp" }));
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang agent" }));

    const agentEditor = await screen.findByRole("textbox", { name: "Yêu cầu cho agent" });
    await waitFor(() => expect(agentEditor).toHaveTextContent("Mô tả thủ công"));
    expect(await screen.findByText("Agent 17")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /UniWork/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cao/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hạn" })).toHaveTextContent("30 thg 9");

    fireEvent.input(agentEditor, { target: { innerHTML: "<p>Yêu cầu riêng cho agent</p>" } });
    await waitFor(() =>
      expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.agentPrompt).toBe("Yêu cầu riêng cho agent"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang thủ công" }));

    const restoredManualEditor = await screen.findByRole("textbox", { name: "Mô tả" });
    await waitFor(() => expect(restoredManualEditor).toHaveTextContent("Mô tả thủ công"));
    expect(screen.getByRole("switch", { name: "Tạo tiếp" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang agent" }));
    const restoredAgentEditor = await screen.findByRole("textbox", { name: "Yêu cầu cho agent" });
    await waitFor(() => expect(restoredAgentEditor).toHaveTextContent("Yêu cầu riêng cho agent"));
  });

  it("keeps the dialog open and clears the title when create-another is on", async () => {
    const onOpenChange = vi.fn();
    render(
      wrap(
        <NewTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={onOpenChange}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("switch", { name: "Tạo tiếp" }));
    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), {
      target: { value: "Việc tiếp theo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Tiêu đề issue")).toHaveValue(""),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("submits surface defaults and the full human create payload", async () => {
    render(
      wrap(
        <NewTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={() => {}}
          defaults={{
            status: "in_progress",
            priority: "high",
            assignee_id: "u1",
            assignee_kind: "human",
            project_id: "p1",
            start_date: "2026-09-20",
            due_date: "2026-09-30",
            label_ids: ["label-1"],
          }}
        />,
      ),
    );

    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "  Sửa lỗi  " } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Mô tả" })).toBeInTheDocument());
    fireEvent.input(screen.getByRole("textbox", { name: "Mô tả" }), {
      target: { innerHTML: "<p>Chi tiết</p>" },
    });
    await waitFor(() =>
      expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.description).toBe("Chi tiết"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/tasks",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            title: "Sửa lỗi",
            description: "Chi tiết",
            status: "in_progress",
            priority: "high",
            assignee_id: "u1",
            assignee_kind: "human",
            project_id: "p1",
            start_date: "2026-09-20",
            due_date: "2026-09-30",
            label_ids: ["label-1"],
          }),
          headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
        }),
      ),
    );
    await waitFor(() =>
      expect(useCreateTaskDraftStore.getState().settingsFor("ws1")).toMatchObject({
        status: "in_progress",
        priority: "high",
        projectId: "p1",
      }),
    );
  });

  it("creates with rich text, a selected parent and stage, and custom properties", async () => {
    const property = {
      id: "prop-1", organization_id: "o1", workspace_id: "ws1", name: "Story points",
      type: "number", description: "", config: {}, position: 1, usage_count: 0,
      created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z",
    };
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (path.endsWith("/task-properties")) return { properties: [property], total: 1 };
      if (path.endsWith("/tasks") && init?.method !== "POST") {
        return { tasks: [{ ...createdTask, id: "parent-1", identifier: "UNI-9", title: "Task cha" }] };
      }
      if (init?.method === "POST" && path.endsWith("/tasks")) return { task: createdTask };
      return {};
    });
    render(wrap(
      <NewTaskDialog
        workspaceId="ws1"
        open
        showTrigger={false}
        onOpenChange={() => {}}
        defaults={{ parent_task_id: "parent-1" }}
      />,
    ));

    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Task đầy đủ" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Mô tả" })).toBeInTheDocument());
    fireEvent.input(screen.getByRole("textbox", { name: "Mô tả" }), {
      target: { innerHTML: "<p><strong>Chi tiết</strong></p>" },
    });
    expect(screen.getByRole("button", { name: "Task cha" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thêm trường" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Giai đoạn" }));
    fireEvent.click(await screen.findByRole("button", { name: "Giai đoạn 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm trường" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Story points" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Story points" }), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/tasks",
      expect.objectContaining({ body: expect.objectContaining({
        parent_task_id: "parent-1", stage: 2, properties: { "prop-1": 5 },
      }) }),
    ));
  });

  it("keeps the dialog and draft open when a malformed create response degrades to null", async () => {
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (init?.method === "POST" && path.endsWith("/tasks")) return { task: { id: 123 } };
      return {};
    });
    const onOpenChange = vi.fn();
    render(
      wrap(
        <NewTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={onOpenChange}
        />,
      ),
    );

    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Giữ lại" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(screen.getByPlaceholderText("Tiêu đề issue")).toHaveValue("Giữ lại"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("does not clear or close a newer draft when an older submit resolves late", async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (init?.method === "POST" && path.endsWith("/tasks")) {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      return {};
    });
    const onOpenChange = vi.fn();
    render(
      wrap(
        <NewTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={onOpenChange}
        />,
      ),
    );

    const title = screen.getByPlaceholderText("Tiêu đề issue");
    fireEvent.change(title, { target: { value: "Bản gửi" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    fireEvent.change(title, { target: { value: "Bản mới hơn" } });
    await act(async () => resolveCreate?.({ task: createdTask }));

    await waitFor(() => expect(title).toHaveValue("Bản mới hơn"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("offers a direct View action to the created task", async () => {
    const push = vi.fn();
    const navigation: NavigationAdapter = {
      push,
      replace: vi.fn(),
      back: vi.fn(),
      pathname: "/acme/team/tasks",
      searchParams: new URLSearchParams(),
      getShareableUrl: (path) => path,
    };
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />
        </WorkspaceProvider>,
        navigation,
      ),
    );

    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Sửa lỗi" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const options = toastSuccess.mock.calls.at(-1)?.[1] as {
      action?: { label: string; onClick: () => void };
    };
    expect(options.action?.label).toBe("Xem task");
    options.action?.onClick();
    expect(push).toHaveBeenCalledWith("/acme/team/tasks/t1");
  });

  it("uploads before create, gates submit, and binds the staged attachment", async () => {
    let resolveUpload: ((value: unknown) => void) | undefined;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (init?.method === "POST" && path.endsWith("/attachments")) {
        return new Promise((resolve) => { resolveUpload = resolve; });
      }
      if (init?.method === "POST" && path.endsWith("/tasks")) return { task: createdTask };
      return {};
    });
    render(wrap(<NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />));
    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Có tệp" } });
    const form = screen.getByPlaceholderText("Tiêu đề issue").closest("form")!;
    const fileInput = form.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).not.toBeNull();
    expect(fileInput).toHaveAttribute("multiple");
    fireEvent.change(fileInput!, {
      target: { files: [new File(["hello"], "brief.txt", { type: "text/plain" })] },
    });
    fireEvent.submit(form);
    expect(requestMock.mock.calls.filter(([path, init]) => String(path).endsWith("/tasks") && init?.method === "POST")).toHaveLength(0);

    await waitFor(() => expect(resolveUpload).toBeTypeOf("function"));
    await act(async () => resolveUpload?.({
      id: "att-1", workspace_id: "ws1", task_id: null, filename: "brief.txt",
      url: "/api/v1/attachments/att-1/content", download_url: "/api/v1/attachments/att-1/download",
      content_type: "text/plain", size_bytes: 5, created_at: "2026-09-16T00:00:00Z",
    }));
    await waitFor(() => expect(screen.queryByText("brief.txt")).toBeInTheDocument());
    fireEvent.submit(form);

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/tasks",
      expect.objectContaining({ body: expect.objectContaining({ attachment_ids: ["att-1"] }) }),
    ));
  });

  it("uploads multiple files inline and binds only attachments left in the description", async () => {
    let sequence = 0;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (init?.method === "POST" && path.endsWith("/attachments")) {
        sequence += 1;
        const id = `att-${sequence}`;
        const filename = sequence === 1 ? "first.txt" : "second.txt";
        return {
          id,
          workspace_id: "ws1",
          task_id: null,
          filename,
          url: `/api/v1/attachments/${id}/content`,
          download_url: `/api/v1/attachments/${id}/download`,
          content_type: "text/plain",
          size_bytes: 5,
          created_at: "2026-09-16T00:00:00Z",
        };
      }
      if (init?.method === "POST" && path.endsWith("/tasks")) return { task: createdTask };
      return {};
    });

    render(wrap(<NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />));
    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Nhiều tệp" } });
    const form = screen.getByPlaceholderText("Tiêu đề issue").closest("form")!;
    const fileInput = form.querySelector<HTMLInputElement>("input[type='file']")!;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["first"], "first.txt", { type: "text/plain" }),
          new File(["second"], "second.txt", { type: "text/plain" }),
        ],
      },
    });

    await screen.findByText("first.txt");
    await screen.findByText("second.txt");
    const removeButtons = screen.getAllByRole("button", { name: "Gỡ tệp đính kèm" });
    fireEvent.click(removeButtons[0]!);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/tasks",
        expect.objectContaining({
          body: expect.objectContaining({ attachment_ids: ["att-2"] }),
        }),
      ),
    );
  });

  it("keeps the draft and offers view-existing when create hits an active duplicate", async () => {
    const push = vi.fn();
    const navigation: NavigationAdapter = {
      push,
      replace: vi.fn(),
      back: vi.fn(),
      pathname: "/acme/team/tasks",
      searchParams: new URLSearchParams(),
      getShareableUrl: (path) => path,
    };
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
      if (path.endsWith("/organizations") || path.includes("/organizations?")) {
        return { organizations: [{ id: "o1", role: "owner" }] };
      }
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (path.endsWith("/task-properties")) return { properties: [], total: 0 };
      if (path.endsWith("/tasks") && init?.method !== "POST") return { tasks: [] };
      if (init?.method === "POST" && path.endsWith("/tasks")) {
        throw new ApiError("trùng", "active_duplicate_task", 409, undefined, {
          task_id: "dup-1",
          identifier: "UNI-7",
          title: "Login bug",
        });
      }
      return {};
    });
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />
        </WorkspaceProvider>,
        navigation,
      ),
    );

    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), { target: { value: "Login bug" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByPlaceholderText("Tiêu đề issue")).toHaveValue("Login bug");
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.title).toBe("Login bug");
    const options = toastError.mock.calls.at(-1)?.[1] as {
      action?: { label: string; onClick: () => void };
    };
    expect(options.action?.label).toBe("Xem task");
    options.action?.onClick();
    expect(push).toHaveBeenCalledWith("/acme/team/tasks/dup-1");
  });
});
