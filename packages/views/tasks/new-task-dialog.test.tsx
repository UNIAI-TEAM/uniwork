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

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

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
    requestMock.mockReset();
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/members")) return { members: [] };
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

    fireEvent.change(screen.getByLabelText("Tiêu đề"), { target: { value: "Không cảnh báo" } });

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

    fireEvent.change(screen.getByLabelText("Tiêu đề"), { target: { value: "  Sửa lỗi  " } });
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

    fireEvent.change(screen.getByLabelText("Tiêu đề"), { target: { value: "Task đầy đủ" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Mô tả" })).toBeInTheDocument());
    fireEvent.input(screen.getByRole("textbox", { name: "Mô tả" }), {
      target: { innerHTML: "<p><strong>Chi tiết</strong></p>" },
    });
    expect(screen.getByRole("combobox", { name: "Task cha" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Giai đoạn"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Story points"), { target: { value: "5" } });
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

    fireEvent.change(screen.getByLabelText("Tiêu đề"), { target: { value: "Giữ lại" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() => expect(screen.getByLabelText("Tiêu đề")).toHaveValue("Giữ lại"));
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

    const title = screen.getByLabelText("Tiêu đề");
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

    fireEvent.change(screen.getByLabelText("Tiêu đề"), { target: { value: "Sửa lỗi" } });
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
    fireEvent.change(screen.getByLabelText("Tiêu đề"), { target: { value: "Có tệp" } });
    const form = screen.getByLabelText("Tiêu đề").closest("form")!;
    fireEvent.change(screen.getByLabelText("Đính kèm"), {
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
});
