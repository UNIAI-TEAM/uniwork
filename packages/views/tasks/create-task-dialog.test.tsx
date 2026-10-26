import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { useCreateTaskDraftStore } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { createFakeDrivePickerAdapter } from "../integrations/drive-picker";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrap, wrapWithNav } from "../test/api-mock";
import { CreateTaskDialog } from "./create-task-dialog";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

initI18n();

describe("CreateTaskDialog", () => {
  beforeEach(() => {
    toastError.mockReset();
    requestMock.mockReset();
    requestMock.mockImplementation(async () => ({}));
  });

  it("switches body mode without unmounting the dialog role", async () => {
    render(
      wrap(
        <CreateTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang agent" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      await screen.findByRole("textbox", { name: "Yêu cầu cho agent" }),
    ).toBeInTheDocument();
  });

  it("renders the manual composer with compact property pills", () => {
    render(
      wrap(
        <CreateTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );

    const status = screen.getByRole("button", { name: "Trạng thái: Cần làm" });
    const priority = screen.getByRole("button", { name: "Độ ưu tiên: Không ưu tiên" });

    expect(status).toHaveClass("rounded-full");
    expect(priority).toHaveClass("rounded-full");
    expect(status).not.toHaveClass("w-full");
    expect(priority).not.toHaveClass("w-full");
    expect(status.querySelector('[data-slot="status-icon"]')).not.toBeNull();
    expect(priority.querySelector('[data-slot="priority-icon"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Không có dự án" })).toHaveTextContent("📁");
    expect(screen.getByRole("button", { name: "Chuyển sang agent" })).toHaveClass("pointer-coarse:min-h-11");
    expect(screen.getByTestId("create-task-composer-body")).toHaveClass("flex-1");
    expect(screen.getByTestId("create-task-property-toolbar")).toHaveClass("shrink-0");
    expect(screen.getByTestId("create-task-footer")).toHaveClass("sm:flex");
    expect(screen.getByTestId("create-task-footer")).toHaveClass(
      "border-surface-border/50",
    );
  });

  it("sends a submitter's task through it and leaves the person's own draft alone", async () => {
    // Draft writes need a session owner; without one every write is a no-op.
    setSessionUser({ id: "u1", email: "u1@x.com", display_name: "U1" } as User);
    const mine = { title: "Bản nháp của tôi", idempotencyKey: "mine", version: 3 };
    useCreateTaskDraftStore.setState({ drafts: { ws1: { mine } }, activeDraftIds: { ws1: "mine" }, ownerId: "u1" });
    const submit = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    const { rerender } = render(
      wrap(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={onOpenChange}
          defaults={{ title: "Gửi biên bản", assignee_id: null, project_id: null }}
          submitter={{ submit, pending: false }}
          heading="Việc sau họp 1/2"
        />,
      ),
    );

    const title = screen.getByRole("textbox", { name: "Tiêu đề issue" });
    expect(title).toHaveValue("Gửi biên bản");
    expect(screen.getByText("Việc sau họp 1/2")).toBeInTheDocument();
    // No drafts, agent mode or "create another" of its own.
    expect(screen.queryByRole("button", { name: "Chuyển sang agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lưu bản nháp" })).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Gửi biên bản họp" } });
    fireEvent.click(screen.getByRole("button", { name: /^Tạo/ }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ title: "Gửi biên bản họp" })));
    // The next item: the composer starts over on it, with the caret in its title.
    screen.getByRole("button", { name: /^Tạo/ }).focus();
    rerender(
      wrap(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={onOpenChange}
          defaults={{ title: "Đặt phòng", assignee_id: null, project_id: null }}
          submitter={{ submit, pending: false }}
          heading="Việc sau họp 2/2"
        />,
      ),
    );
    const next = await screen.findByDisplayValue("Đặt phòng");
    await waitFor(() => expect(next).toHaveFocus());

    expect(requestMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/tasks$/), expect.objectContaining({ method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Closing asks nothing and drops nothing: the active draft is still the person's.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")).toEqual(mine);
    resetAuthStoreForTests();
  });

  it("shows agent unavailable toast and does not POST /tasks when creating in agent mode", async () => {
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.endsWith("/agents")) {
        return {
          agents: [
            {
              id: "agent-1",
              organization_id: "o1",
              name: "Agent 17",
              handle: "agent-17",
              description: "",
              status: "active",
              owner_user_id: "u1",
            },
          ],
        };
      }
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (path.endsWith("/tasks") && init?.method !== "POST") return { tasks: [] };
      return {};
    });

    render(
      wrap(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          initialMode="agent"
          onOpenChange={() => {}}
        />,
      ),
    );

    const editor = await screen.findByRole("textbox", { name: "Yêu cầu cho agent" });
    await screen.findByText("Agent 17");
    fireEvent.input(editor, { target: { innerHTML: "<p>Viết summary</p>" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Gửi cho agent/ })).not.toHaveAttribute(
        "aria-disabled",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Gửi cho agent/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/tasks$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("opens the paperclip menu with 'Tải tệp lên' and 'Từ Google Drive', renders draft Drive chips, removes chips, and submits drive_files in POST /tasks", async () => {
    const user: User = {
      id: "u1",
      email: "a@b.c",
      display_name: "Minh",
      onboarded_at: "2026-01-01T00:00:00Z",
      email_verified_at: "2026-01-01T00:00:00Z",
      onboarding_questionnaire: {},
      locale: "vi",
    };
    const workspace: Workspace = {
      id: "ws1",
      slug: "team",
      name: "Moon",
      organization_id: "o1",
      organization_slug: "acme",
      organization_name: "Acme",
    };
    setSessionUser(user);
    useCreateTaskDraftStore.setState({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: null,
    });

    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "shared",
        },
        {
          id: "gsheet_2",
          name: "Ngân sách Q4",
          mimeType: "application/vnd.google-apps.spreadsheet",
          sharingState: "shared",
        },
      ],
    });

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string; body?: unknown }) => {
        if (path === "/api/v1/config") {
          return {
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          };
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return {
            connections: [
              {
                id: "dc_1",
                provider: "google",
                google_email: "uni-work1@gmail.com",
                status: "active",
                needs_reconnect: false,
                linked_file_count: 3,
                connected_at: "2026-10-26T09:00:00Z",
                updated_at: "2026-10-26T09:00:00Z",
              },
            ],
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-connections/dc_1/picker-token" &&
          init?.method === "POST"
        ) {
          return {
            access_token: "ya29.tok",
            expires_at: "2026-10-26T10:30:00Z",
            developer_key: "AIzaSyTest",
            app_id: "123456",
            google_email: "uni-work1@gmail.com",
          };
        }
        if (path === "/api/v1/workspaces/ws1/tasks" && init?.method === "POST") {
          return {
            task: {
              id: "t_created",
              organization_id: "o1",
              workspace_id: "ws1",
              number: 42,
              identifier: "UNI-42",
              revision: 1,
              title: "Chuẩn bị kế hoạch Q4",
              description: "",
              status: "todo",
              priority: "none",
              position: 1024,
              created_by: "u1",
              created_at: "2026-10-26T10:00:00Z",
              updated_at: "2026-10-26T10:00:00Z",
            },
          };
        }
        return {};
      },
    );

    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            onOpenChange={() => {}}
            pickerAdapter={adapter}
          />
        </WorkspaceProvider>,
      ),
    );

    const attachBtn = await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Đính kèm tệp" });
      expect(btn).toHaveAttribute("aria-haspopup", "menu");
      return btn;
    });

    fireEvent.click(attachBtn);

    expect(
      await screen.findByRole("menuitem", { name: "Tải tệp lên" }),
    ).toBeInTheDocument();
    const fromDriveItem = await screen.findByRole("menuitem", {
      name: /Từ Google Drive/,
    });
    expect(fromDriveItem).toHaveTextContent("1 tài khoản đã kết nối");

    fireEvent.click(fromDriveItem);

    await waitFor(() => {
      expect(
        screen.getByTestId("create-task-drive-chip-gdoc_1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("create-task-drive-chip-gsheet_2"),
      ).toBeInTheDocument();
    });

    // Picker did NOT call POST .../drive-files during draft stage
    expect(requestMock).not.toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files",
      expect.anything(),
    );

    // Remove the second chip before submitting
    fireEvent.click(
      screen.getByRole("button", { name: "Gỡ Ngân sách Q4" }),
    );
    expect(
      screen.queryByTestId("create-task-drive-chip-gsheet_2"),
    ).toBeNull();

    // Enter title and submit
    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), {
      target: { value: "Chuẩn bị kế hoạch Q4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Tạo/ }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/tasks",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            title: "Chuẩn bị kế hoạch Q4",
            drive_files: [
              {
                connection_id: "dc_1",
                external_file_id: "gdoc_1",
              },
            ],
          }),
        }),
      );
    });

    resetAuthStoreForTests();
  });

  it("keeps the modal open and marks the offending Drive chip when POST /tasks fails on a Drive file", async () => {
    const user: User = {
      id: "u1",
      email: "a@b.c",
      display_name: "Minh",
      onboarded_at: "2026-01-01T00:00:00Z",
      email_verified_at: "2026-01-01T00:00:00Z",
      onboarding_questionnaire: {},
      locale: "vi",
    };
    const workspace: Workspace = {
      id: "ws1",
      slug: "team",
      name: "Moon",
      organization_id: "o1",
      organization_slug: "acme",
      organization_name: "Acme",
    };
    setSessionUser(user);
    useCreateTaskDraftStore.setState({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: null,
    });

    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_bad",
          name: "Tài liệu bị thu hồi",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "shared",
        },
      ],
    });

    const onOpenChange = vi.fn();

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path === "/api/v1/config") {
          return {
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          };
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return {
            connections: [
              {
                id: "dc_1",
                provider: "google",
                google_email: "uni-work1@gmail.com",
                status: "active",
                needs_reconnect: false,
                linked_file_count: 1,
                connected_at: "2026-10-26T09:00:00Z",
                updated_at: "2026-10-26T09:00:00Z",
              },
            ],
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-connections/dc_1/picker-token" &&
          init?.method === "POST"
        ) {
          return {
            access_token: "ya29.tok",
            expires_at: "2026-10-26T10:30:00Z",
            developer_key: "AIzaSyTest",
            app_id: "123456",
            google_email: "uni-work1@gmail.com",
          };
        }
        if (path === "/api/v1/workspaces/ws1/tasks" && init?.method === "POST") {
          throw new ApiError(
            "drive grant required",
            "drive_grant_required",
            403,
            undefined,
            {
              connection_id: "dc_1",
              external_file_id: "gdoc_bad",
            },
          );
        }
        return {};
      },
    );

    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            onOpenChange={onOpenChange}
            pickerAdapter={adapter}
          />
        </WorkspaceProvider>,
      ),
    );

    const attachBtn = await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Đính kèm tệp" });
      expect(btn).toHaveAttribute("aria-haspopup", "menu");
      return btn;
    });

    fireEvent.click(attachBtn);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Từ Google Drive/ }),
    );

    const chip = await screen.findByTestId("create-task-drive-chip-gdoc_bad");
    expect(chip).not.toHaveAttribute("data-error");

    fireEvent.change(screen.getByPlaceholderText("Tiêu đề issue"), {
      target: { value: "Việc có tệp lỗi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Tạo/ }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining("Tài liệu bị thu hồi"),
      );
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByTestId("create-task-drive-chip-gdoc_bad"),
    ).toHaveAttribute("data-error", "true");
    expect(
      screen.getByTestId("create-task-drive-chip-gdoc_bad"),
    ).toHaveTextContent("Bạn chưa cấp cho UniWork quyền đọc tệp này.");

    resetAuthStoreForTests();
  });
});
