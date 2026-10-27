import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import {
  FeatureFlagService,
  FeatureFlagsProvider,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { useCreateTaskDraftStore } from "@uniwork/core/tasks/stores/create-task-draft-store";
import type { Task, User, Workspace } from "@uniwork/core/types";
import { ContentEditor } from "../editor";
import { LinkHoverCard } from "../editor/link-hover-card";
import { createFakeDrivePickerAdapter } from "../integrations/drive-picker";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { CreateTaskDialog } from "./create-task-dialog";
import { TaskDetailEditors } from "./detail/components/task-detail-editors";

vi.mock("./detail/components/task-detail-attachments-slot", () => ({
  TaskDetailAttachmentsSlot: () => null,
}));
vi.mock("./detail/components/task-detail-context-line", () => ({
  TaskDetailContextLine: () => null,
}));
vi.mock("./detail/components/subtasks-section", () => ({
  TaskDetailSubtasksSection: () => null,
}));
vi.mock("./detail/components/task-detail-timeline-slot", () => ({
  TaskDetailTimelineSlot: () => null,
}));
vi.mock("../graph/node-history-section", () => ({
  NodeHistorySection: () => null,
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
  },
}));

initI18n();

const QUERY_WAIT_OPTIONS = { timeout: 5000 } as const;

const defaultUser: User = {
  id: "u1",
  email: "minh@vietants.vn",
  display_name: "Minh",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const defaultWorkspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Moon",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const sampleTask: Task = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "ws1",
  number: 42,
  identifier: "MOON-42",
  revision: 1,
  title: "Chuẩn bị kế hoạch Q4",
  description: "",
  status: "todo",
  priority: "medium",
  kind: "normal",
  position: 1,
  assignee_kind: "human",
  created_by_kind: "human",
  created_by: "u1",
  created_at: "2026-10-26T08:00:00Z",
  updated_at: "2026-10-26T08:00:00Z",
};

const ACTIVE_CONN = {
  id: "dc_1",
  provider: "google",
  google_email: "uni-work1@gmail.com",
  status: "active",
  needs_reconnect: false,
  linked_file_count: 1,
  connected_at: "2026-10-26T09:00:00Z",
  updated_at: "2026-10-26T09:00:00Z",
};

function renderWithWorkspace(
  ui: React.ReactElement,
  opts?: { driveFlag?: boolean },
) {
  const service = new FeatureFlagService(
    new StaticProvider({
      drive_connector: { default: opts?.driveFlag ?? true },
    }),
  );
  return wrapWithNav(
    <FeatureFlagsProvider service={service}>
      <WorkspaceProvider workspace={defaultWorkspace} user={defaultUser}>
        {ui}
      </WorkspaceProvider>
    </FeatureFlagsProvider>,
  );
}

function pasteTextIntoEditor(editorEl: HTMLElement, text: string, html = "") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type: string) =>
        type === "text/plain" ? text : type === "text/html" ? html : "",
    },
  });
  act(() => {
    editorEl.dispatchEvent(event);
  });
}
describe("Drive paste URL suggestion chips (W5, spec §7.5)", () => {
  beforeEach(async () => {
    await setLocale("vi");
    setSessionUser(defaultUser);
    useCreateTaskDraftStore.setState({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: null,
    });
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    requestMock.mockReset();
  });

  it("shows the suggestion chip on pasting a Drive URL in task detail while still inserting the link in the editor", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    const pastedUrl =
      "https://docs.google.com/document/d/1GdocPlanQ4_0123456789ab/edit?usp=sharing";
    pasteTextIntoEditor(editor, pastedUrl);

    // Chip is rendered with a button group and accessible dismiss label
    const chipGroup = await screen.findByTestId(
      "drive-paste-suggestion-chip-1GdocPlanQ4_0123456789ab",
      {},
      QUERY_WAIT_OPTIONS,
    );
    expect(chipGroup).toHaveAttribute("role", "group");
    expect(
      await screen.findByRole(
        "button",
        {
          name: "Liên kết tệp Google Drive này vào việc?",
        },
        QUERY_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Bỏ qua gợi ý liên kết Google Drive",
      }),
    ).toBeInTheDocument();

    // Link insertion in the editor is preserved
    const anchor = editor.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe(pastedUrl);

    // Never calls the server with the pasted URL
    expect(requestMock).not.toHaveBeenCalledWith(
      expect.stringContaining("1GdocPlanQ4_0123456789ab"),
      expect.anything(),
    );
  });

  it("shows no chip when pasting a non-Drive URL or a Drive folder URL", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    pasteTextIntoEditor(
      editor,
      "https://example.com/spec and https://drive.google.com/drive/folders/folder_123",
    );

    expect(screen.queryByTestId("drive-paste-suggestion-chips")).toBeNull();
  });

  it("shows no chip when Drive is unavailable (flag off or config.drive.available false)", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: false },
          rum_sample_rate: 0,
          drive: { available: false },
        };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: false },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/document/d/1GdocHidden_0123456789ab/edit",
    );

    expect(screen.queryByTestId("drive-paste-suggestion-chips")).toBeNull();
  });

  it("deduplicates pasted IDs, skips already-linked files, and allows dismissing a chip", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return {
          files: [
            {
              id: "df_existing",
              task_id: "t1",
              workspace_id: "ws1",
              external_file_id: "1AlreadyLinkedId_0123456",
              name: "Đã gắn",
              mime_type: "application/vnd.google-apps.document",
              icon_kind: "google_doc",
              sharing_state: "shared",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_connection_lost: false,
              bound_by_id: "u1",
              bound_by_name: "Minh",
              created_by: "u1",
              created_by_name: "Minh",
              linked_at: "2026-10-26T08:00:00Z",
              viewer_access: "granted",
              viewer_connection_id: "dc_1",
              viewer_account_email: "uni-work1@gmail.com",
              open_url:
                "https://docs.google.com/document/d/1AlreadyLinkedId_0123456/edit",
              can_remove_from_task: true,
              can_propose: true,
              can_ask: true,
              tasks_created: { count: 0 },
            },
          ],
        };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    // Wait for config query to settle so Drive is available
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/config",
        expect.anything(),
      );
    }, QUERY_WAIT_OPTIONS);
    // Paste duplicate IDs + already linked ID
    pasteTextIntoEditor(
      editor,
      [
        "https://docs.google.com/document/d/1DupDoc_0123456789abcdef/edit",
        "https://docs.google.com/document/u/0/d/1DupDoc_0123456789abcdef/view",
        "https://docs.google.com/document/d/1AlreadyLinkedId_0123456/edit",
      ].join(" "),
    );

    const chip = await screen.findByTestId(
      "drive-paste-suggestion-chip-1DupDoc_0123456789abcdef",
      {},
      QUERY_WAIT_OPTIONS,
    );
    expect(chip).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByTestId(
          "drive-paste-suggestion-chip-1AlreadyLinkedId_0123456",
        ),
      ).toBeNull();
    }, QUERY_WAIT_OPTIONS);
    expect(
      screen.getAllByRole("button", {
        name: "Liên kết tệp Google Drive này vào việc?",
      }),
    ).toHaveLength(1);

    // Dismiss the chip
    fireEvent.click(
      screen.getByRole("button", {
        name: "Bỏ qua gợi ý liên kết Google Drive",
      }),
    );

    expect(
      screen.queryByTestId(
        "drive-paste-suggestion-chip-1DupDoc_0123456789abcdef",
      ),
    ).toBeNull();

    // Re-pasting a dismissed ID in the same session does not bring it back
    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/document/d/1DupDoc_0123456789abcdef/edit",
    );
    expect(
      screen.queryByTestId(
        "drive-paste-suggestion-chip-1DupDoc_0123456789abcdef",
      ),
    ).toBeNull();
  });

  it("opens the Picker with fileIds: [id] on task detail and links the file (with Q6 confirm dialog)", async () => {
    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "1GdocTaskLink_0123456789",
          name: "Tài liệu Q4",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "private",
        },
      ],
    });

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path === "/api/v1/config") {
          return {
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          };
        }
        if (path === "/api/v1/workspaces/ws1/me") {
          return {
            membership: { user_id: "u1", role: "member", source: "membership" },
          };
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return { connections: [ACTIVE_CONN] };
        }
        if (path === "/api/v1/tasks/t1/drive-files") {
          return { files: [] };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-connections/dc_1/picker-token" &&
          init?.method === "POST"
        ) {
          return {
            access_token: "picker-tok",
            expires_at: "2026-10-26T10:30:00Z",
            developer_key: "dev-key",
            app_id: "123456",
            google_email: "uni-work1@gmail.com",
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files" &&
          init?.method === "POST"
        ) {
          return {
            results: [
              {
                external_file_id: "1GdocTaskLink_0123456789",
                outcome: "linked",
              },
            ],
          };
        }
        return {};
      },
    );

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
          pickerAdapter={adapter}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/document/d/1GdocTaskLink_0123456789/edit",
    );

    const linkBtn = await screen.findByRole(
      "button",
      {
        name: "Liên kết tệp Google Drive này vào việc?",
      },
      QUERY_WAIT_OPTIONS,
    );
    fireEvent.click(linkBtn);

    // Confirm dialog appears because sharingState is "private"
    const confirmBtn = await screen.findByRole(
      "button",
      {
        name: "Liên kết 1 tệp",
      },
      QUERY_WAIT_OPTIONS,
    );
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.fileIds).toEqual(["1GdocTaskLink_0123456789"]);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files",
        expect.objectContaining({
          method: "POST",
          body: {
            connection_id: "dc_1",
            external_file_ids: ["1GdocTaskLink_0123456789"],
            task_id: "t1",
          },
        }),
      );
    }, QUERY_WAIT_OPTIONS);

    await waitFor(() => {
      expect(
        screen.queryByTestId(
          "drive-paste-suggestion-chip-1GdocTaskLink_0123456789",
        ),
      ).toBeNull();
    }, QUERY_WAIT_OPTIONS);
  });

  it("opens the Picker with fileIds: [id] in create-task draft mode and adds a W4 draft Drive chip", async () => {
    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "1GsheetDraft_0123456789a",
          name: "Bảng ngân sách Q4",
          mimeType: "application/vnd.google-apps.spreadsheet",
          sharingState: "shared",
        },
      ],
    });

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
          return { connections: [ACTIVE_CONN] };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-connections/dc_1/picker-token" &&
          init?.method === "POST"
        ) {
          return {
            access_token: "picker-tok",
            expires_at: "2026-10-26T10:30:00Z",
            developer_key: "dev-key",
            app_id: "123456",
            google_email: "uni-work1@gmail.com",
          };
        }
        return {};
      },
    );

    render(
      renderWithWorkspace(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          onOpenChange={() => {}}
          pickerAdapter={adapter}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả",
    });

    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/spreadsheets/d/1GsheetDraft_0123456789a/edit",
    );

    const linkBtn = await screen.findByRole(
      "button",
      {
        name: "Liên kết tệp Google Drive này vào việc?",
      },
      QUERY_WAIT_OPTIONS,
    );
    fireEvent.click(linkBtn);

    // Becomes a W4 draft Drive chip and clears the suggestion chip
    const draftChip = await screen.findByTestId(
      "create-task-drive-chip-1GsheetDraft_0123456789a",
      {},
      QUERY_WAIT_OPTIONS,
    );
    expect(draftChip).toHaveTextContent("Bảng ngân sách Q4");
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.fileIds).toEqual(["1GsheetDraft_0123456789a"]);
    expect(
      screen.queryByTestId(
        "drive-paste-suggestion-chip-1GsheetDraft_0123456789a",
      ),
    ).toBeNull();

    // Pasting the already-drafted file ID again does not show a suggestion chip
    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/spreadsheets/d/1GsheetDraft_0123456789a/edit",
    );
    expect(
      screen.queryByTestId(
        "drive-paste-suggestion-chip-1GsheetDraft_0123456789a",
      ),
    ).toBeNull();
    resetAuthStoreForTests();
  });

  it("shows 'Kết nối Google Drive để liên kết' when the user has no Drive connection and opens the connect dialog on click", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    pasteTextIntoEditor(
      editor,
      "https://drive.google.com/file/d/1GfileNoConn_0123456789a/view",
    );

    const connectBtn = await screen.findByRole(
      "button",
      {
        name: "Kết nối Google Drive để liên kết",
      },
      QUERY_WAIT_OPTIONS,
    );
    expect(connectBtn).toBeInTheDocument();

    fireEvent.click(connectBtn);

    // Opens the W1/W3 connect account step dialog
    expect(
      await screen.findByText(
        "Kết nối tài khoản Google Drive để chọn và liên kết tệp ngay tại đây.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps undo history and chip behaviour sane after pasting a Drive URL", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    const pastedUrl =
      "https://docs.google.com/document/d/1GdocUndoSanity_01234567/edit";
    pasteTextIntoEditor(editor, pastedUrl);

    expect(
      await screen.findByTestId(
        "drive-paste-suggestion-chip-1GdocUndoSanity_01234567",
        {},
        QUERY_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(editor.querySelector("a")?.getAttribute("href")).toBe(pastedUrl);

    // Undo removes the pasted link in the editor in a single step because
    // driveUrlPaste never dispatches a ProseMirror transaction; the non-intrusive
    // suggestion chip remains actionable/dismissible until dismissed or linked.
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(editor.querySelector("a")).toBeNull();
    expect(
      screen.getByTestId(
        "drive-paste-suggestion-chip-1GdocUndoSanity_01234567",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Bỏ qua gợi ý liên kết Google Drive",
      }),
    );
    expect(
      screen.queryByTestId(
        "drive-paste-suggestion-chip-1GdocUndoSanity_01234567",
      ),
    ).toBeNull();
  });

  it("handles editor-level paste of prose mixed with a URL and of two distinct Drive URLs", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    // Wait for permissions query to resolve so canEdit is true
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/me");
    }, QUERY_WAIT_OPTIONS);

    // 1. Prose mixed with a single Drive URL -> 1 chip (no kind suffix needed)
    const urlOne =
      "https://docs.google.com/document/d/1GdocProseMixOne_0123456/edit";
    pasteTextIntoEditor(editor, `Xem bản nháp tại ${urlOne} trước buổi họp.`);

    expect(
      await screen.findByTestId(
        "drive-paste-suggestion-chip-1GdocProseMixOne_0123456",
        {},
        QUERY_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole(
        "button",
        {
          name: "Liên kết tệp Google Drive này vào việc?",
        },
        QUERY_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(editor).toHaveTextContent("Xem bản nháp tại");
    expect(editor).toHaveTextContent("trước buổi họp.");

    // 2. Paste containing two more distinct Drive URLs -> 3 chips total, each disambiguated by file kind (F-3)
    const urlTwo =
      "https://docs.google.com/spreadsheets/d/1GsheetMultiTwo_01234567/edit";
    const urlThree =
      "https://drive.google.com/file/d/1GfileMultiThree_0123456/view";
    pasteTextIntoEditor(editor, `Tài liệu liên quan: ${urlTwo} và ${urlThree}`);

    expect(
      await screen.findByTestId(
        "drive-paste-suggestion-chip-1GsheetMultiTwo_01234567",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId(
        "drive-paste-suggestion-chip-1GfileMultiThree_0123456",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Liên kết tệp Google Drive này vào việc? · Google Docs",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Liên kết tệp Google Drive này vào việc? · Google Sheets",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Liên kết tệp Google Drive này vào việc? · Tệp Google Drive",
      }),
    ).toBeInTheDocument();
  });

  it("pins LinkHoverCard zIndex below the chip container z-50 so a portaled hover card cannot paint over the chip (RF-1)", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    const anchor = document.createElement("a");
    document.body.appendChild(anchor);

    render(
      renderWithWorkspace(
        <>
          <TaskDetailEditors
            task={sampleTask}
            workspaceId="ws1"
            onSaveTitle={vi.fn()}
            onSaveDescription={vi.fn()}
          />
          <LinkHoverCard
            visible
            href="https://docs.google.com/document/d/1GdocStackOrder_01234567/edit"
            anchorEl={anchor}
            cardRef={{ current: null }}
            onCardEnter={vi.fn()}
            onCardLeave={vi.fn()}
          />
        </>,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });
    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/document/d/1GdocStackOrder_01234567/edit",
    );

    const chipsContainer = await screen.findByTestId(
      "drive-paste-suggestion-chips",
      {},
      QUERY_WAIT_OPTIONS,
    );
    const hoverCard = document.querySelector<HTMLElement>(".link-hover-card");
    expect(hoverCard).not.toBeNull();

    // jsdom cannot compute paint order or CSS class rules, so assert the card's inline zIndex (< 50) against the chip's z-50 class.
    const chipZMatch = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(chipsContainer.className);
    expect(chipsContainer).toHaveClass("relative", "z-50");
    expect(Number(hoverCard!.style.zIndex)).toBe(49);
    expect(Number(hoverCard!.style.zIndex)).toBeLessThan(Number(chipZMatch?.[1]));

    anchor.remove();
  });

  it("pins the responsive wrapping and flex-shrink classes on the chip list, chip group, action button, and dismiss button so multi-chip suffixes do not clip or push the dismiss X off-screen at 390px (F-6)", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });
    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/document/d/1GdocWrapLayout_012345678/edit\nhttps://drive.google.com/file/d/1GfileWrapLayout_01234567/view",
    );

    const chipsList = await screen.findByTestId(
      "drive-paste-suggestion-chips",
      {},
      QUERY_WAIT_OPTIONS,
    );
    const chipGroup = await screen.findByTestId(
      "drive-paste-suggestion-chip-1GfileWrapLayout_01234567",
      {},
      QUERY_WAIT_OPTIONS,
    );
    const buttons = chipGroup.querySelectorAll("button");
    const actionButton = buttons[0]!;
    const dismissButton = buttons[1]!;
    const labelSpan = actionButton.querySelector("span")!;

    // jsdom cannot measure flex/viewport layout at 390px, so pin the Tailwind classes that bound width, wrap the label, and keep the dismiss X inside the chip.
    expect(chipsList).toHaveClass("flex", "flex-wrap");
    expect(chipGroup).toHaveClass("inline-flex", "max-w-full", "min-w-0");
    expect(actionButton).toHaveClass(
      "min-w-0",
      "shrink",
      "whitespace-normal",
      "text-left",
      "pointer-coarse:min-h-11",
      "pointer-coarse:min-w-11",
    );
    expect(actionButton).not.toHaveClass("shrink-0", "whitespace-nowrap");
    expect(labelSpan).toHaveClass("min-w-0", "break-words");
    expect(dismissButton).toHaveClass(
      "shrink-0",
      "pointer-coarse:min-h-11",
      "pointer-coarse:min-w-11",
    );
  });

  it("shows no suggestion chip in task detail when the user has no workspace role and cannot edit the task (F-2)", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/ws1/me") {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      }
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return { connections: [ACTIVE_CONN] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return {};
    });

    render(
      renderWithWorkspace(
        <TaskDetailEditors
          task={sampleTask}
          workspaceId="ws1"
          onSaveTitle={vi.fn()}
          onSaveDescription={vi.fn()}
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Mô tả công việc",
    });

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/me");
    }, QUERY_WAIT_OPTIONS);

    const pastedUrl =
      "https://docs.google.com/document/d/1GdocNoWorkspaceRole_0123/edit";
    pasteTextIntoEditor(editor, pastedUrl);

    // Link is still inserted into the editor (pre-existing editor behaviour),
    // but no suggestion chip is shown for a user who has no workspace role.
    expect(editor.querySelector("a")?.getAttribute("href")).toBe(pastedUrl);
    await waitFor(() => {
      expect(screen.queryByTestId("drive-paste-suggestion-chips")).toBeNull();
      expect(
        screen.queryByTestId(
          "drive-paste-suggestion-chip-1GdocNoWorkspaceRole_0123",
        ),
      ).toBeNull();
    }, QUERY_WAIT_OPTIONS);
  });

  it("keeps a ContentEditor without onPasteDriveFileIds completely inert on pasting a Drive URL", async () => {
    render(
      renderWithWorkspace(
        <ContentEditor
          defaultValue=""
          ariaLabel="Trình soạn thảo bình luận"
          disableMentions
        />,
        { driveFlag: true },
      ),
    );

    const editor = await screen.findByRole("textbox", {
      name: "Trình soạn thảo bình luận",
    });

    const pastedUrl =
      "https://docs.google.com/document/d/1GdocInertComment_012345/edit";
    pasteTextIntoEditor(editor, pastedUrl);

    expect(editor.querySelector("a")?.getAttribute("href")).toBe(pastedUrl);
    expect(screen.queryByTestId("drive-paste-suggestion-chips")).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
