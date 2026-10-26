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
      "https://docs.google.com/document/d/gdoc_plan_q4/edit?usp=sharing";
    pasteTextIntoEditor(editor, pastedUrl);

    // Chip is rendered with a button group and accessible dismiss label
    const chipGroup = await screen.findByTestId(
      "drive-paste-suggestion-chip-gdoc_plan_q4",
    );
    expect(chipGroup).toHaveAttribute("role", "group");
    expect(
      await screen.findByRole("button", {
        name: "Liên kết tệp Google Drive này vào việc?",
      }),
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
      expect.stringContaining("gdoc_plan_q4"),
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
      "https://docs.google.com/document/d/gdoc_hidden/edit",
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
              external_file_id: "already_linked_id",
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
                "https://docs.google.com/document/d/already_linked_id/edit",
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
    });
    // Paste duplicate IDs + already linked ID
    pasteTextIntoEditor(
      editor,
      [
        "https://docs.google.com/document/d/dup_doc_1/edit",
        "https://docs.google.com/document/u/0/d/dup_doc_1/view",
        "https://docs.google.com/document/d/already_linked_id/edit",
      ].join(" "),
    );

    const chip = await screen.findByTestId(
      "drive-paste-suggestion-chip-dup_doc_1",
    );
    expect(chip).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByTestId("drive-paste-suggestion-chip-already_linked_id"),
      ).toBeNull();
    });
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
      screen.queryByTestId("drive-paste-suggestion-chip-dup_doc_1"),
    ).toBeNull();

    // Re-pasting a dismissed ID in the same session does not bring it back
    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/document/d/dup_doc_1/edit",
    );
    expect(
      screen.queryByTestId("drive-paste-suggestion-chip-dup_doc_1"),
    ).toBeNull();
  });

  it("opens the Picker with fileIds: [id] on task detail and links the file (with Q6 confirm dialog)", async () => {
    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_task_link",
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
                external_file_id: "gdoc_task_link",
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
      "https://docs.google.com/document/d/gdoc_task_link/edit",
    );

    const linkBtn = await screen.findByRole("button", {
      name: "Liên kết tệp Google Drive này vào việc?",
    });
    fireEvent.click(linkBtn);

    // Confirm dialog appears because sharingState is "private"
    const confirmBtn = await screen.findByRole("button", {
      name: "Liên kết 1 tệp",
    });
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.fileIds).toEqual(["gdoc_task_link"]);

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files",
        expect.objectContaining({
          method: "POST",
          body: {
            connection_id: "dc_1",
            external_file_ids: ["gdoc_task_link"],
            task_id: "t1",
          },
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("drive-paste-suggestion-chip-gdoc_task_link"),
      ).toBeNull();
    });
  });

  it("opens the Picker with fileIds: [id] in create-task draft mode and adds a W4 draft Drive chip", async () => {
    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gsheet_draft_1",
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
      "https://docs.google.com/spreadsheets/d/gsheet_draft_1/edit",
    );

    const linkBtn = await screen.findByRole("button", {
      name: "Liên kết tệp Google Drive này vào việc?",
    });
    fireEvent.click(linkBtn);

    // Becomes a W4 draft Drive chip and clears the suggestion chip
    const draftChip = await screen.findByTestId(
      "create-task-drive-chip-gsheet_draft_1",
    );
    expect(draftChip).toHaveTextContent("Bảng ngân sách Q4");
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.fileIds).toEqual(["gsheet_draft_1"]);
    expect(
      screen.queryByTestId("drive-paste-suggestion-chip-gsheet_draft_1"),
    ).toBeNull();

    // Pasting the already-drafted file ID again does not show a suggestion chip
    pasteTextIntoEditor(
      editor,
      "https://docs.google.com/spreadsheets/d/gsheet_draft_1/edit",
    );
    expect(
      screen.queryByTestId("drive-paste-suggestion-chip-gsheet_draft_1"),
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
      "https://drive.google.com/file/d/gfile_no_conn/view",
    );

    const connectBtn = await screen.findByRole("button", {
      name: "Kết nối Google Drive để liên kết",
    });
    expect(connectBtn).toBeInTheDocument();

    fireEvent.click(connectBtn);

    // Opens the W1/W3 connect account step dialog
    expect(
      await screen.findByText(
        "Kết nối tài khoản Google Drive để chọn và liên kết tệp ngay tại đây.",
      ),
    ).toBeInTheDocument();
  });
});
