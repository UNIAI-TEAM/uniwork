import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { DriveTaskProposal } from "@uniwork/core/drive";
import {
  FeatureFlagService,
  FeatureFlagsProvider,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { useCreateTaskDraftStore } from "@uniwork/core/tasks/stores/create-task-draft-store";
import type { User, Workspace } from "@uniwork/core/types";
import { shortDateFormat } from "../common/date-pill";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { CreateTaskDialog } from "./create-task-dialog";
import { appendDrivePromptHint } from "./drive-prompt-hints";
import {
  DriveProposalReviewProvider,
  DriveProposeTasksPopover,
  resolveDriveProposalError,
} from "./drive-task-proposal-popover";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const { t } = initI18n();

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

function renderInWorkspace(ui: React.ReactElement) {
  const service = new FeatureFlagService(
    new StaticProvider({
      drive_connector: { default: true },
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

function makeProposal(overrides: Partial<DriveTaskProposal> = {}): DriveTaskProposal {
  return {
    id: "dtp_1",
    workspace_id: "ws1",
    drive_file_id: "df_1",
    drive_file_name: "Kế hoạch ra mắt Q4",
    drive_file_mime_type: "application/vnd.google-apps.document",
    drive_file_icon_kind: "google_doc",
    sharing_state: "shared",
    connection_id: "dc_1",
    reader_account_email: "uni-work1@gmail.com",
    requested_by: "u1",
    prompt: "Chia việc",
    truncated: false,
    status: "ready",
    items: [
      {
        index: 0,
        title: "Chốt phạm vi tính năng beta",
        label_ids: [],
        goal: "Chốt danh sách tính năng beta",
        checklist: ["Họp chốt"],
        excerpt: { section: "Mục 2", quote: "Nhóm sản phẩm chốt phạm vi" },
        blocked_by_indexes: [],
      },
    ],
    tasks_created: { count: 0 },
    prior_creations: [],
    created_at: "2026-10-26T10:00:00Z",
    expires_at: "2026-11-02T10:00:00Z",
    ...overrides,
  };
}

describe("CreateTaskAgentPanel with Drive chip (W6, spec §8.1, §8.2, §8.8)", () => {
  beforeEach(async () => {
    await setLocale("vi");
    toastError.mockReset();
    requestMock.mockReset();
    requestMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/ai/capabilities")) return { enabled: true };
      return {};
    });
    resetAuthStoreForTests();
    setSessionUser(defaultUser);
    useCreateTaskDraftStore.setState({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: "u1",
    });
  });

  it("keeps old behaviour when no Drive chip is present: renders AgentPicker, requires selectedAgent, and shows priority/due/upload buttons", async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/agents")) return { agents: [] };
      if (path.endsWith("/projects")) return { projects: [], total: 0 };
      if (path.endsWith("/tasks")) return { tasks: [] };
      return {};
    });

    render(
      renderInWorkspace(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          initialMode="agent"
          onOpenChange={() => {}}
        />,
      ),
    );

    expect(await screen.findByText("Chọn agent")).toBeInTheDocument();
    expect(screen.queryByTestId("create-task-agent-created-by-uni")).toBeNull();
    expect(screen.getByRole("button", { name: "Thêm trường" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đính kèm tệp" })).toBeInTheDocument();
    expect(screen.queryByTestId("drive-prompt-hints")).toBeNull();
    expect(
      document.querySelector('[data-placeholder="Mô tả việc cần agent thực hiện…"]'),
    ).not.toBeNull();
    const submitBtn = screen.getByRole("button", { name: /Gửi cho agent/ });
    expect(submitBtn).toHaveAttribute("aria-disabled", "true");
  });

  it("replaces AgentPicker with 'Tạo bởi UNI', hides priority/due/upload buttons, and sends with no agent available when a Drive chip is attached", async () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_drive_1",
      projectId: "proj_1",
      parentTaskId: "task_parent_1",
      agentPrompt: "Tạo việc cho mục Phân công",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
          iconKind: "google_doc",
        },
      ],
    });

    const proposalGate = Promise.withResolvers<{ proposal: DriveTaskProposal }>();

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (path.endsWith("/agents")) return { agents: [] };
        if (path.endsWith("/projects")) {
          return {
            projects: [
              {
                id: "proj_1",
                organization_id: "o1",
                workspace_id: "ws1",
                title: "Ra mắt Q4",
                description: "",
                status: "in_progress",
                priority: "high",
                revision: 1,
                task_count: 1,
                done_count: 0,
                resource_count: 0,
                created_at: "2026-10-26T08:00:00Z",
                updated_at: "2026-10-26T08:00:00Z",
              },
            ],
            total: 1,
          };
        }
        if (path.endsWith("/tasks") && init?.method !== "POST") {
          return {
            tasks: [
              {
                id: "task_parent_1",
                workspace_id: "ws1",
                identifier: "UNI-1042",
                title: "Chuẩn bị kế hoạch Q4",
                description: "",
                status: "todo",
                priority: "high",
                position: 1,
                created_by: "u1",
                created_at: "2026-10-26T08:00:00Z",
                updated_at: "2026-10-26T08:00:00Z",
              },
            ],
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
        if (path.startsWith("/api/v1/workspaces/ws1/drive-files?")) {
          return { files: [], total_count: 0, next_cursor: null };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files" &&
          init?.method === "POST"
        ) {
          return {
            results: [
              {
                external_file_id: "gdoc_1",
                outcome: "linked",
                file: {
                  id: "df_linked_1",
                  workspace_id: "ws1",
                  external_file_id: "gdoc_1",
                  name: "Kế hoạch ra mắt Q4",
                  mime_type: "application/vnd.google-apps.document",
                  icon_kind: "google_doc",
                  sharing_state: "shared",
                  web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
                  open_url:
                    "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
                  viewer_access: "granted",
                  viewer_connection_id: "dc_1",
                  viewer_account_email: "uni-work1@gmail.com",
                },
              },
            ],
          };
        }
        if (path === "/api/v1/workspaces/ws1/drive-files/df_linked_1") {
          return {
            file: {
              id: "df_linked_1",
              organization_id: "o1",
              workspace_id: "ws1",
              external_file_id: "gdoc_1",
              name: "Kế hoạch ra mắt Q4",
              mime_type: "application/vnd.google-apps.document",
              icon_kind: "google_doc",
              web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
              open_url:
                "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
              owner_display: "Lan",
              sharing_state: "shared",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_connection_lost: false,
              bound_by_id: "u1",
              bound_by_name: "Lan",
              created_by: "u1",
              created_by_kind: "human",
              created_by_name: "Lan",
              created_at: "2026-10-26T08:00:00Z",
              updated_at: "2026-10-26T08:00:00Z",
              viewer_access: "granted",
              viewer_connection_id: "dc_1",
              viewer_account_email: "uni-work1@gmail.com",
              can_unlink: false,
              can_rebind: false,
              can_propose: true,
              can_ask: true,
              used_in_count: 0,
              used_in_tasks: [],
              tasks_created: { count: 0 },
            },
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_linked_1/task-proposals" &&
          init?.method === "POST"
        ) {
          return proposalGate.promise;
        }
        return {};
      },
    );

    const onOpenChange = vi.fn();
    const onReviewOpen = vi.fn();

    render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={onOpenChange}
          />
        </DriveProposalReviewProvider>,
      ),
    );

    // 1. "Tạo bởi UNI" row replaces AgentPicker
    const createdByUni = await screen.findByTestId(
      "create-task-agent-created-by-uni",
      {},
      QUERY_WAIT_OPTIONS,
    );
    expect(createdByUni).toHaveTextContent("Tạo bởi");
    expect(createdByUni).toHaveTextContent("UNI");
    expect(createdByUni).toHaveTextContent("Agent");
    expect(screen.queryByText("Chọn agent")).toBeNull();

    // 2. Priority, due date, and upload buttons are hidden; Project, "Task con của", and reading account line stay
    expect(screen.queryByRole("button", { name: "Thêm trường" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Đính kèm tệp" })).toBeNull();
    expect(await screen.findByText(/Ra mắt Q4/, {}, QUERY_WAIT_OPTIONS)).toBeInTheDocument();
    expect(
      await screen.findByText("Task con của UNI-1042", {}, QUERY_WAIT_OPTIONS),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "UNI đọc tệp bằng tài khoản uni-work1@gmail.com rồi đưa ra danh sách việc để bạn duyệt. Chưa có việc nào được tạo trước khi bạn duyệt.",
        {},
        QUERY_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();

    // 3. No prior creations -> no warning banner, submit button says "Gửi cho agent" and is active even with 0 workspace agents
    expect(screen.queryByTestId("drive-recreate-warning")).toBeNull();
    const submitBtn = screen.getByRole("button", { name: /Gửi cho agent/ });
    expect(submitBtn).not.toHaveAttribute("aria-disabled");
    expect(submitBtn).not.toHaveAttribute("aria-describedby");

    fireEvent.click(submitBtn);

    // 4. Pending state "UNI đang đọc tài liệu…" + Hủy
    expect(
      await screen.findByText("UNI đang đọc tài liệu…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hủy" }),
    ).toBeInTheDocument();

    const createdProposal = makeProposal({ id: "dtp_99", drive_file_id: "df_linked_1" });
    act(() => {
      proposalGate.resolve({ proposal: createdProposal });
    });

    // 5. On success, hands proposal to DriveProposalReviewProvider and closes dialog
    await waitFor(() => {
      expect(onReviewOpen).toHaveBeenCalledWith(createdProposal);
    }, QUERY_WAIT_OPTIONS);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files/df_linked_1/task-proposals",
      expect.objectContaining({
        method: "POST",
        body: {
          prompt: "Tạo việc cho mục Phân công",
          project_id: "proj_1",
          parent_task_id: "task_parent_1",
          context_task_id: "task_parent_1",
        },
      }),
    );
  });

  it("renders re-creation warning with role='status', aria-describedby on 'Vẫn gửi cho UNI', and never blocks sending (§8.8)", async () => {
    const lastCreatedAt = "2026-10-25T10:00:00Z";
    const expectedDate = new Date(lastCreatedAt).toLocaleDateString(
      "vi",
      shortDateFormat("2026"),
    );

    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_drive_prior",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_1",
          driveFileId: "df_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
          iconKind: "google_doc",
          tasksCreated: {
            count: 4,
            last_created_at: lastCreatedAt,
            last_created_by_name: "Lan",
          },
        },
      ],
    });

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (path.endsWith("/agents")) return { agents: [] };
        if (path.endsWith("/projects")) return { projects: [], total: 0 };
        if (path.endsWith("/tasks")) return { tasks: [] };
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
        if (path === "/api/v1/workspaces/ws1/drive-files/df_1") {
          return {
            file: {
              id: "df_1",
              organization_id: "o1",
              workspace_id: "ws1",
              external_file_id: "gdoc_1",
              name: "Kế hoạch ra mắt Q4",
              mime_type: "application/vnd.google-apps.document",
              icon_kind: "google_doc",
              web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
              open_url:
                "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_by_id: "u1",
              created_by: "u1",
              created_at: "2026-10-26T08:00:00Z",
              viewer_access: "granted",
              viewer_account_email: "uni-work1@gmail.com",
              tasks_created: {
                count: 4,
                last_created_at: lastCreatedAt,
                last_created_by_name: "Lan",
              },
            },
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          return {
            proposal: makeProposal({
              id: "dtp_recreate",
              tasks_created: {
                count: 4,
                last_created_at: lastCreatedAt,
                last_created_by_name: "Lan",
              },
            }),
          };
        }
        return {};
      },
    );

    const onReviewOpen = vi.fn();
    render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={() => {}}
          />
        </DriveProposalReviewProvider>,
      ),
    );

    const warning = await screen.findByTestId("drive-recreate-warning");
    expect(warning).toHaveAttribute("role", "status");
    expect(warning).toHaveTextContent(
      `Tài liệu này đã được dùng để tạo 4 việc (lần gần nhất ${expectedDate}, bởi Lan). Tạo thêm có thể trùng.`,
    );
    const viewLink = within(warning).getByRole("link", {
      name: "Xem các việc đã tạo",
    });
    expect(viewLink).toHaveAttribute(
      "href",
      "/acme/team/documents/drive/df_1#drive-tasks-created",
    );

    const sendAnywayBtn = screen.getByRole("button", {
      name: /Vẫn gửi cho UNI/,
    });
    expect(sendAnywayBtn).toHaveAttribute("aria-describedby", warning.id);
    expect(sendAnywayBtn).not.toHaveAttribute("aria-disabled");

    // Warning does not block sending even when prompt is empty
    fireEvent.click(sendAnywayBtn);
    await waitFor(() => {
      expect(onReviewOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dtp_recreate" }),
      );
    }, QUERY_WAIT_OPTIONS);
  });

  it("allows cancelling an in-flight proposal request and surfaces ErrorSDO codes (§7.10, §8.2)", async () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_drive_err",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_1",
          driveFileId: "df_1",
          name: "Tệp lạ.bin",
          mimeType: "application/octet-stream",
        },
      ],
    });

    const slowGate = Promise.withResolvers<{ proposal: DriveTaskProposal }>();
    let callCount = 0;

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (path === "/api/v1/workspaces/ws1/drive-files/df_1") {
          return {
            file: {
              id: "df_1",
              organization_id: "o1",
              workspace_id: "ws1",
              external_file_id: "gdoc_1",
              name: "Tệp lạ.bin",
              mime_type: "application/octet-stream",
              icon_kind: "generic",
              web_view_link: "https://drive.google.com/file/d/gdoc_1/view",
              open_url:
                "https://drive.google.com/file/d/gdoc_1/view?authuser=uni-work1%40gmail.com",
              owner_display: "Minh",
              sharing_state: "shared",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_connection_lost: false,
              bound_by_id: "u1",
              bound_by_name: "Minh",
              created_by: "u1",
              created_by_kind: "human",
              created_by_name: "Minh",
              created_at: "2026-10-26T08:00:00Z",
              updated_at: "2026-10-26T08:00:00Z",
              viewer_access: "granted",
              viewer_account_email: "uni-work1@gmail.com",
              can_unlink: true,
              can_rebind: true,
              can_propose: true,
              can_ask: true,
              used_in_count: 0,
              used_in_tasks: [],
              tasks_created: { count: 0 },
              task_creations: [],
            },
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          callCount += 1;
          if (callCount === 1) return slowGate.promise;
          throw new ApiError(
            "unsupported format",
            "drive_format_unsupported",
            422,
          );
        }
        return {};
      },
    );

    const onReviewOpen = vi.fn();

    render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={() => {}}
          />
        </DriveProposalReviewProvider>,
      ),
    );

    const submitBtn = await screen.findByRole("button", { name: /Gửi cho agent/ });
    fireEvent.click(submitBtn);

    const cancelBtn = await screen.findByRole("button", { name: "Hủy" });
    fireEvent.click(cancelBtn);

    // Late resolution after cancel is ignored
    act(() => {
      slowGate.resolve({ proposal: makeProposal({ id: "dtp_ignored" }) });
    });
    expect(onReviewOpen).not.toHaveBeenCalled();

    // Second attempt fails with drive_format_unsupported -> shows error + "Mở trên Google Drive" link
    fireEvent.click(await screen.findByRole("button", { name: /Gửi cho agent/ }));
    const errAlert = await screen.findByTestId("drive-proposal-error");
    expect(errAlert).toHaveTextContent("UNI chưa đọc được định dạng này.");
    const openLink = within(errAlert).getByRole("link", {
      name: "Mở trên Google Drive",
    });
    expect(openLink).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/gdoc_1/view?authuser=uni-work1%40gmail.com",
    );
  });

  it("keeps the draft, does not close, does not call B5, and shows an error toast when no DriveProposalReviewProvider is mounted (F2, N3)", async () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_no_provider",
      agentPrompt: "Giữ bản nháp",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_1",
          driveFileId: "df_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });

    let proposeCalled = false;
    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          proposeCalled = true;
          return { proposal: makeProposal({ id: "dtp_no_provider" }) };
        }
        return {};
      },
    );

    const onOpenChange = vi.fn();
    render(
      renderInWorkspace(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          initialMode="agent"
          onOpenChange={onOpenChange}
        />,
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: /Gửi cho agent/ }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Chưa mở được bước duyệt đề xuất việc lúc này. Bản nháp của bạn vẫn được giữ lại.",
      );
    }, QUERY_WAIT_OPTIONS);
    expect(proposeCalled).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.idempotencyKey).toBe(
      "draft_no_provider",
    );
  });

  it("fetches file detail after link when receipt has no tasks_created: stops with warning on count > 0 and waits for a second click, or sends at once on count === 0 (F3, F4, N1)", async () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_fresh_prior",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_fresh_prior",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });

    let linkCallCount = 0;
    let detailCallCount = 0;
    let proposeCallCount = 0;
    let linkSignal: AbortSignal | undefined;
    let detailSignal: AbortSignal | undefined;

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string; signal?: AbortSignal }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (path.startsWith("/api/v1/workspaces/ws1/drive-files?")) {
          return { files: [], total_count: 0, next_cursor: null };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files" &&
          init?.method === "POST"
        ) {
          linkCallCount += 1;
          linkSignal = init.signal;
          if (linkCallCount === 1) {
            return {
              results: [
                {
                  external_file_id: "gdoc_fresh_prior",
                  outcome: "error",
                  error_code: "drive_grant_required",
                  error_message: "User has not authorized file",
                },
              ],
            };
          }
          return {
            results: [
              {
                external_file_id: "gdoc_fresh_prior",
                outcome: "already_linked",
                file: {
                  id: "df_fresh_prior",
                  workspace_id: "ws1",
                  external_file_id: "gdoc_fresh_prior",
                  name: "Kế hoạch ra mắt Q4",
                  mime_type: "application/vnd.google-apps.document",
                  icon_kind: "google_doc",
                  sharing_state: "shared",
                  web_view_link: "https://docs.google.com/document/d/gdoc_fresh_prior/edit",
                  open_url: "https://docs.google.com/document/d/gdoc_fresh_prior/edit",
                  viewer_access: "granted",
                },
              },
            ],
          };
        }
        if (path === "/api/v1/workspaces/ws1/drive-files/df_fresh_prior") {
          if (detailCallCount === 0) detailSignal = init?.signal;
          detailCallCount += 1;
          return {
            file: {
              id: "df_fresh_prior",
              organization_id: "o1",
              workspace_id: "ws1",
              external_file_id: "gdoc_fresh_prior",
              name: "Kế hoạch ra mắt Q4",
              mime_type: "application/vnd.google-apps.document",
              icon_kind: "google_doc",
              web_view_link: "https://docs.google.com/document/d/gdoc_fresh_prior/edit",
              open_url: "https://docs.google.com/document/d/gdoc_fresh_prior/edit",
              owner_display: "Lan",
              sharing_state: "shared",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_connection_lost: false,
              bound_by_id: "u1",
              bound_by_name: "Lan",
              created_by: "u1",
              created_by_kind: "human",
              created_by_name: "Lan",
              created_at: "2026-10-26T08:00:00Z",
              updated_at: "2026-10-26T08:00:00Z",
              viewer_access: "granted",
              can_unlink: false,
              can_rebind: false,
              can_propose: true,
              can_ask: true,
              used_in_count: 0,
              used_in_tasks: [],
              tasks_created: {
                count: 3,
                last_created_by_name: "Lan",
              },
            },
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_fresh_prior/task-proposals" &&
          init?.method === "POST"
        ) {
          proposeCallCount += 1;
          return { proposal: makeProposal({ id: "dtp_second_click" }) };
        }
        return {};
      },
    );

    const onReviewOpen = vi.fn();
    render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={() => {}}
          />
        </DriveProposalReviewProvider>,
      ),
    );

    // 1. First click fails with drive_grant_required -> maps through real ApiError to §7.10 copy and passes AbortSignal (F4)
    fireEvent.click(
      await screen.findByRole("button", { name: /Gửi cho agent/ }, QUERY_WAIT_OPTIONS),
    );
    const errAlert = await screen.findByTestId("drive-proposal-error", {}, QUERY_WAIT_OPTIONS);
    expect(errAlert).toHaveTextContent(
      "Bạn chưa cấp cho UniWork quyền đọc tệp này. Chọn lại tệp trong Google Picker rồi thử lại.",
    );
    expect(linkSignal).toBeInstanceOf(AbortSignal);
    expect(proposeCallCount).toBe(0);

    // 2. Retry links file (receipt without tasks_created) and detail GET returns count: 3 -> stops before B5, shows warning and "Vẫn gửi cho UNI" (F3, N1)
    fireEvent.click(screen.getByRole("button", { name: /Gửi cho agent/ }));
    const warning = await screen.findByTestId("drive-recreate-warning", {}, QUERY_WAIT_OPTIONS);
    expect(warning).toHaveTextContent(
      "Tài liệu này đã được dùng để tạo 3 việc (bởi Lan). Tạo thêm có thể trùng.",
    );
    expect(detailCallCount).toBeGreaterThanOrEqual(1);
    expect(detailSignal).toBe(linkSignal);
    const sendAnywayBtn = screen.getByRole("button", { name: /Vẫn gửi cho UNI/ });
    expect(sendAnywayBtn).toHaveAttribute("aria-describedby", warning.id);
    expect(proposeCallCount).toBe(0);
    expect(onReviewOpen).not.toHaveBeenCalled();

    // 3. Second click after warning proceeds to B5
    fireEvent.click(sendAnywayBtn);
    await waitFor(() => {
      expect(onReviewOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dtp_second_click" }),
      );
    }, QUERY_WAIT_OPTIONS);
    expect(proposeCallCount).toBe(1);
  });

  it("sends to B5 at once after link when detail GET returns tasks_created.count === 0 (N1)", async () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_fresh_zero",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_fresh_zero",
          name: "Biên bản họp tuần",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });

    let detailFetched = false;
    let proposeCallCount = 0;

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (path.startsWith("/api/v1/workspaces/ws1/drive-files?")) {
          return { files: [], total_count: 0, next_cursor: null };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files" &&
          init?.method === "POST"
        ) {
          return {
            results: [
              {
                external_file_id: "gdoc_fresh_zero",
                outcome: "linked",
                file: {
                  id: "df_fresh_zero",
                  workspace_id: "ws1",
                  external_file_id: "gdoc_fresh_zero",
                  name: "Biên bản họp tuần",
                  mime_type: "application/vnd.google-apps.document",
                  icon_kind: "google_doc",
                  sharing_state: "shared",
                  web_view_link: "https://docs.google.com/document/d/gdoc_fresh_zero/edit",
                  open_url: "https://docs.google.com/document/d/gdoc_fresh_zero/edit",
                  viewer_access: "granted",
                },
              },
            ],
          };
        }
        if (path === "/api/v1/workspaces/ws1/drive-files/df_fresh_zero") {
          detailFetched = true;
          return {
            file: {
              id: "df_fresh_zero",
              organization_id: "o1",
              workspace_id: "ws1",
              external_file_id: "gdoc_fresh_zero",
              name: "Biên bản họp tuần",
              mime_type: "application/vnd.google-apps.document",
              icon_kind: "google_doc",
              web_view_link: "https://docs.google.com/document/d/gdoc_fresh_zero/edit",
              open_url: "https://docs.google.com/document/d/gdoc_fresh_zero/edit",
              owner_display: "Lan",
              sharing_state: "shared",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_connection_lost: false,
              bound_by_id: "u1",
              bound_by_name: "Lan",
              created_by: "u1",
              created_by_kind: "human",
              created_by_name: "Lan",
              created_at: "2026-10-26T08:00:00Z",
              updated_at: "2026-10-26T08:00:00Z",
              viewer_access: "granted",
              can_unlink: false,
              can_rebind: false,
              can_propose: true,
              can_ask: true,
              used_in_count: 0,
              used_in_tasks: [],
              tasks_created: { count: 0 },
            },
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_fresh_zero/task-proposals" &&
          init?.method === "POST"
        ) {
          proposeCallCount += 1;
          return { proposal: makeProposal({ id: "dtp_immediate" }) };
        }
        return {};
      },
    );

    const onReviewOpen = vi.fn();
    render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={() => {}}
          />
        </DriveProposalReviewProvider>,
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Gửi cho agent/ }, QUERY_WAIT_OPTIONS),
    );
    await waitFor(() => {
      expect(onReviewOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dtp_immediate" }),
      );
    }, QUERY_WAIT_OPTIONS);
    expect(detailFetched).toBe(true);
    expect(proposeCallCount).toBe(1);
  });

  it("aborts in-flight proposal request on unmount (e.g. Esc / dismiss) so late resolution neither clears the draft nor opens review (F1)", async () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_unmount_abort",
      agentPrompt: "Đừng xóa khi đóng",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_1",
          driveFileId: "df_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });

    const slowGate = Promise.withResolvers<{ proposal: DriveTaskProposal }>();
    let capturedSignal: AbortSignal | undefined;

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string; signal?: AbortSignal }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          capturedSignal = init.signal;
          return slowGate.promise;
        }
        return {};
      },
    );

    const onReviewOpen = vi.fn();
    const onOpenChange = vi.fn();
    const { unmount } = render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={onOpenChange}
          />
        </DriveProposalReviewProvider>,
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: /Gửi cho agent/ }));
    expect(await screen.findByText("UNI đang đọc tài liệu…")).toBeInTheDocument();

    // F7: Pressing Escape while "UNI đang đọc tài liệu…" cancels reading, aborts signal, and keeps dialog + draft open
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(capturedSignal?.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: /Gửi cho agent/ })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await act(async () => {
      slowGate.resolve({ proposal: makeProposal({ id: "dtp_after_esc" }) });
    });

    expect(onReviewOpen).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.idempotencyKey).toBe(
      "draft_unmount_abort",
    );

    unmount();
  });

  it("gates Drive-mode send when AI capability is disabled or can_propose is false (F5)", async () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_ai_disabled",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_1",
          driveFileId: "df_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });

    let proposeCalled = false;
    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) {
          return { enabled: false };
        }
        if (path === "/api/v1/workspaces/ws1/drive-files/df_1") {
          return {
            file: {
              id: "df_1",
              organization_id: "o1",
              workspace_id: "ws1",
              external_file_id: "gdoc_1",
              name: "Kế hoạch ra mắt Q4",
              mime_type: "application/vnd.google-apps.document",
              icon_kind: "google_doc",
              web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
              open_url: "https://docs.google.com/document/d/gdoc_1/edit",
              owner_display: "Lan",
              sharing_state: "shared",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_connection_lost: false,
              bound_by_id: "u1",
              bound_by_name: "Lan",
              created_by: "u1",
              created_by_kind: "human",
              created_by_name: "Lan",
              created_at: "2026-10-26T08:00:00Z",
              updated_at: "2026-10-26T08:00:00Z",
              viewer_access: "granted",
              can_unlink: false,
              can_rebind: false,
              can_propose: false,
              can_ask: false,
              used_in_count: 0,
              used_in_tasks: [],
              tasks_created: { count: 0 },
            },
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          proposeCalled = true;
          return { proposal: makeProposal() };
        }
        return {};
      },
    );

    render(
      renderInWorkspace(
        <>
          <DriveProposeTasksPopover workspaceId="ws1" driveFileId="df_1" />
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={() => {}}
          />
        </>,
      ),
    );

    const submitBtn = await screen.findByRole(
      "button",
      { name: /Gửi cho agent/ },
      QUERY_WAIT_OPTIONS,
    );
    await waitFor(() => {
      expect(submitBtn).toHaveAttribute("aria-disabled", "true");
    }, QUERY_WAIT_OPTIONS);
    expect(submitBtn).toHaveAttribute(
      "title",
      "AI chưa khả dụng trên workspace này.",
    );
    const agentHintId = submitBtn.getAttribute("aria-describedby");
    expect(agentHintId).toBeTruthy();
    expect(document.getElementById(agentHintId!)).toHaveTextContent(
      "AI chưa khả dụng trên workspace này.",
    );

    fireEvent.click(submitBtn);
    expect(proposeCalled).toBe(false);

    // Popover trigger is also aria-disabled with visible ai_disabled hint and aria-describedby
    const popTrigger = screen.getByRole("button", { name: "Tạo việc từ tài liệu", hidden: true });
    expect(popTrigger).toHaveAttribute("aria-disabled", "true");
    expect(popTrigger).toHaveAttribute("title", "AI chưa khả dụng trên workspace này.");
    const popHintId = popTrigger.getAttribute("aria-describedby");
    expect(popHintId).toBeTruthy();
    expect(document.getElementById(popHintId!)).toHaveTextContent(
      "AI chưa khả dụng trên workspace này.",
    );
    fireEvent.click(popTrigger);
    expect(screen.queryByLabelText("Gợi ý cho UNI (tùy chọn)")).toBeNull();
    expect(proposeCalled).toBe(false);
  });

  it("renders prompt hints and Drive-mode placeholder with Drive chip, appends hint text into empty and non-empty prompts, sends it in B5 request, and hides hints when gated (UNI-2219)", async () => {
    expect(
      appendDrivePromptHint("", "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này"),
    ).toBe("Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này");
    expect(
      appendDrivePromptHint("Tạo việc mục 2", "Chỉ lấy việc của nhóm BE"),
    ).toBe("Tạo việc mục 2. Chỉ lấy việc của nhóm BE");
    expect(
      appendDrivePromptHint("Tạo việc mục 2.", "Ưu tiên cao cho việc gấp"),
    ).toBe("Tạo việc mục 2. Ưu tiên cao cho việc gấp");

    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_drive_hints",
      agentPrompt: "",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_1",
          driveFileId: "df_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
          iconKind: "google_doc",
        },
      ],
    });

    const slowGate = Promise.withResolvers<{ proposal: DriveTaskProposal }>();
    let canPropose = true;
    let callCount = 0;

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (path.endsWith("/agents")) return { agents: [] };
        if (path.endsWith("/projects")) return { projects: [], total: 0 };
        if (path.endsWith("/tasks")) return { tasks: [] };
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return { connections: [] };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1" ||
          path === "/api/v1/workspaces/ws1/drive-files/df_blocked_1"
        ) {
          return {
            file: {
              id: path.endsWith("df_blocked_1") ? "df_blocked_1" : "df_1",
              organization_id: "o1",
              workspace_id: "ws1",
              external_file_id: "gdoc_1",
              name: "Kế hoạch ra mắt Q4",
              mime_type: "application/vnd.google-apps.document",
              icon_kind: "google_doc",
              web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
              open_url: "https://docs.google.com/document/d/gdoc_1/edit",
              owner_display: "Lan",
              sharing_state: "shared",
              connection_id: "dc_1",
              bound_account_email: "uni-work1@gmail.com",
              bound_connection_lost: false,
              bound_by_id: "u1",
              bound_by_name: "Lan",
              created_by: "u1",
              created_by_kind: "human",
              created_by_name: "Lan",
              created_at: "2026-10-26T08:00:00Z",
              updated_at: "2026-10-26T08:00:00Z",
              viewer_access: canPropose ? "granted" : "missing",
              can_unlink: false,
              can_rebind: false,
              can_propose: canPropose,
              can_ask: canPropose,
              used_in_count: 0,
              used_in_tasks: [],
              tasks_created: { count: 0 },
            },
          };
        }
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          callCount += 1;
          if (callCount === 1) return slowGate.promise;
          return { proposal: makeProposal({ id: "dtp_hints_1" }) };
        }
        return {};
      },
    );

    const onReviewOpen = vi.fn();
    const { unmount } = render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <CreateTaskDialog
            workspaceId="ws1"
            open
            showTrigger={false}
            initialMode="agent"
            onOpenChange={() => {}}
          />
        </DriveProposalReviewProvider>,
      ),
    );

    const hintsGroup = await screen.findByRole(
      "group",
      { name: "Gợi ý mẫu cho UNI" },
      QUERY_WAIT_OPTIONS,
    );
    expect(
      document.querySelector(
        '[data-placeholder="Ví dụ: người phụ trách, hạn hoàn thành, độ ưu tiên hoặc phạm vi cần lấy…"]',
      ),
    ).not.toBeNull();

    const chip1 = within(hintsGroup).getByRole("button", {
      name: "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này",
    });
    const chip2 = within(hintsGroup).getByRole("button", {
      name: "Chỉ lấy việc của nhóm BE",
    });
    const chip3 = within(hintsGroup).getByRole("button", {
      name: "Ưu tiên cao cho việc gấp",
    });
    expect(chip1).toBeInTheDocument();
    expect(chip2).toBeInTheDocument();
    expect(chip3).toBeInTheDocument();
    expect(hintsGroup.className).toContain("flex-wrap");
    expect(chip1.className).toContain("w-auto");
    expect(chip1.className).toContain("max-w-full");

    const proseMirror = document.querySelector(".ProseMirror") as HTMLElement & {
      editor?: {
        state: {
          doc: { content: { size: number } };
          selection: { from: number; to: number; empty: boolean };
        };
      };
    };
    expect(proseMirror?.editor).toBeDefined();

    // Click first chip into empty prompt -> selection collapsed at doc end (F1)
    fireEvent.click(chip1);
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.agentPrompt).toBe(
      "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này",
    );
    expect(proseMirror.editor!.state.selection.empty).toBe(true);
    expect(proseMirror.editor!.state.selection.from).toBe(
      proseMirror.editor!.state.doc.content.size - 1,
    );
    expect(proseMirror.editor!.state.selection.to).toBe(
      proseMirror.editor!.state.doc.content.size - 1,
    );

    // Click second chip into non-empty prompt -> appends, keeps prior text, selection collapsed at doc end (F1)
    fireEvent.click(chip2);
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.agentPrompt).toBe(
      "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này. Chỉ lấy việc của nhóm BE",
    );
    expect(proseMirror.editor!.state.selection.empty).toBe(true);
    expect(proseMirror.editor!.state.selection.from).toBe(
      proseMirror.editor!.state.doc.content.size - 1,
    );
    expect(proseMirror.editor!.state.selection.to).toBe(
      proseMirror.editor!.state.doc.content.size - 1,
    );

    // Gate hint click on in-flight file upload (F2)
    const uploadGate = Promise.withResolvers<{
      attachment: {
        id: string;
        filename: string;
        content_type: string;
        size: number;
        url: string;
      };
    }>();
    const prevImpl = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (
          path === "/api/v1/workspaces/ws1/attachments" &&
          init?.method === "POST"
        ) {
          return uploadGate.promise;
        }
        return prevImpl(path, init);
      },
    );
    fireEvent.paste(proseMirror, {
      clipboardData: {
        files: [new File(["spec"], "spec.pdf", { type: "application/pdf" })],
        getData: () => "",
      },
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Chuyển sang thủ công" }),
      ).toBeDisabled();
    });
    fireEvent.click(chip3);
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.agentPrompt).toBe(
      "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này. Chỉ lấy việc của nhóm BE",
    );
    await act(async () => {
      uploadGate.resolve({
        attachment: {
          id: "att_1",
          filename: "spec.pdf",
          content_type: "application/pdf",
          size: 4,
          url: "/api/v1/attachments/att_1/download",
        },
      });
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Chuyển sang thủ công" }),
      ).not.toBeDisabled();
    });

    // Submit -> while request is pending, no clickable hint chips render
    const submitBtn = screen.getByRole("button", { name: /Gửi cho agent/ });
    fireEvent.click(submitBtn);
    expect(await screen.findByText("UNI đang đọc tài liệu…")).toBeInTheDocument();
    expect(screen.queryByTestId("drive-prompt-hints")).toBeNull();

    await act(async () => {
      slowGate.resolve({ proposal: makeProposal({ id: "dtp_hints_1" }) });
    });
    await waitFor(() => {
      expect(onReviewOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dtp_hints_1" }),
      );
    }, QUERY_WAIT_OPTIONS);
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          prompt:
            "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này. Chỉ lấy việc của nhóm BE",
        }),
      }),
    );
    unmount();

    // Gated by can_propose === false -> no clickable hint chips
    canPropose = false;
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      idempotencyKey: "draft_drive_blocked",
      driveFiles: [
        {
          connectionId: "dc_1",
          externalFileId: "gdoc_blocked_1",
          driveFileId: "df_blocked_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });
    render(
      renderInWorkspace(
        <CreateTaskDialog
          workspaceId="ws1"
          open
          showTrigger={false}
          initialMode="agent"
          onOpenChange={() => {}}
        />,
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByText("Cần cho UniWork đọc tệp trước"),
      ).toBeInTheDocument();
    }, QUERY_WAIT_OPTIONS);
    expect(screen.queryByTestId("drive-prompt-hints")).toBeNull();
  });
});

describe("DriveProposeTasksPopover & resolveDriveProposalError (§7.10, §8.1, §8.2, §8.8)", () => {
  beforeEach(async () => {
    await setLocale("vi");
    toastError.mockReset();
    requestMock.mockReset();
  });

  it("opens popover, shows reading-account line, optional prompt, re-creation warning, and submits to task-proposals", async () => {
    const lastCreatedAt = "2026-10-25T10:00:00Z";
    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          return { proposal: makeProposal({ id: "dtp_pop_1" }) };
        }
      },
    );

    const onReviewOpen = vi.fn();
    render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <DriveProposeTasksPopover
            workspaceId="ws1"
            driveFileId="df_1"
            readerAccountEmail="uni-work1@gmail.com"
            openUrl="https://docs.google.com/document/d/gdoc_1/edit"
            tasksCreated={{
              count: 2,
              last_created_at: lastCreatedAt,
              last_created_by_name: "Minh",
            }}
            contextTaskId="t_ctx"
          />
        </DriveProposalReviewProvider>,
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Tạo việc từ tài liệu" }),
    );

    expect(
      await screen.findByText(
        "UNI đọc tệp bằng tài khoản uni-work1@gmail.com rồi đưa ra danh sách việc để bạn duyệt. Chưa có việc nào được tạo trước khi bạn duyệt.",
      ),
    ).toBeInTheDocument();

    const warning = screen.getByTestId("drive-recreate-warning");
    expect(warning).toHaveAttribute("role", "status");
    const submitBtn = screen.getByRole("button", { name: "Vẫn gửi cho UNI" });
    expect(submitBtn).toHaveAttribute("aria-describedby", warning.id);

    const promptInput = screen.getByLabelText("Gợi ý cho UNI (tùy chọn)");
    fireEvent.change(promptInput, {
      target: { value: "Tập trung mục Rủi ro" },
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onReviewOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dtp_pop_1" }),
      );
    }, QUERY_WAIT_OPTIONS);
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals",
      expect.objectContaining({
        method: "POST",
        body: {
          prompt: "Tập trung mục Rủi ro",
          project_id: undefined,
          parent_task_id: "t_ctx",
          context_task_id: "t_ctx",
        },
      }),
    );
  });

  it("aborts in-flight popover proposal on unmount and skips B5 with toast when no DriveProposalReviewProvider is mounted (F1, F2, N3)", async () => {
    const slowGate = Promise.withResolvers<{ proposal: DriveTaskProposal }>();
    let capturedSignal: AbortSignal | undefined;
    let callCount = 0;

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string; signal?: AbortSignal }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          callCount += 1;
          capturedSignal = init.signal;
          if (callCount === 1) return slowGate.promise;
          return { proposal: makeProposal({ id: "dtp_pop_no_provider" }) };
        }
        return {};
      },
    );

    // 1. Unmount while reading aborts signal and ignores late resolution
    const onReviewOpen = vi.fn();
    const { unmount } = render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <DriveProposeTasksPopover workspaceId="ws1" driveFileId="df_1" />
        </DriveProposalReviewProvider>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Tạo việc từ tài liệu" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gửi cho agent" }));
    expect(await screen.findByText("UNI đang đọc tài liệu…")).toBeInTheDocument();

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
    await act(async () => {
      slowGate.resolve({ proposal: makeProposal({ id: "dtp_pop_late" }) });
    });
    expect(onReviewOpen).not.toHaveBeenCalled();
    expect(callCount).toBe(1);

    // 2. Without provider -> shows error toast without calling B5 and keeps prompt / popover open
    render(
      renderInWorkspace(
        <DriveProposeTasksPopover workspaceId="ws1" driveFileId="df_1" />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tạo việc từ tài liệu" }));
    const promptInput = await screen.findByLabelText("Gợi ý cho UNI (tùy chọn)");
    fireEvent.change(promptInput, { target: { value: "Giữ lại gợi ý" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi cho agent" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Chưa mở được bước duyệt đề xuất việc lúc này. Bản nháp của bạn vẫn được giữ lại.",
      );
    }, QUERY_WAIT_OPTIONS);
    expect(callCount).toBe(1);
    expect(screen.getByLabelText("Gợi ý cho UNI (tùy chọn)")).toHaveValue("Giữ lại gợi ý");
  });

  it("maps every ErrorSDO code and 429 status to localized §7.10 / §8.2 sentences", () => {
    expect(
      resolveDriveProposalError(
        new ApiError("rate limit", "rate_limited", 429),
        t,
      ).message,
    ).toBe("Bạn đã nhờ UNI đọc tài liệu nhiều lần. Thử lại sau ít phút.");

    const cases: Array<[string, string, boolean, boolean]> = [
      [
        "drive_access_required",
        "Bạn chưa cho UniWork đọc tệp này. Hãy cấp quyền đọc tệp trước khi tạo việc.",
        false,
        true,
      ],
      [
        "drive_grant_required",
        "Bạn chưa cấp cho UniWork quyền đọc tệp này. Chọn lại tệp trong Google Picker rồi thử lại.",
        false,
        true,
      ],
      [
        "drive_format_unsupported",
        "UNI chưa đọc được định dạng này.",
        true,
        false,
      ],
      [
        "drive_source_changed",
        "Tài liệu vừa thay đổi kết nối hoặc bị bỏ liên kết.",
        false,
        false,
      ],
      [
        "drive_extract_unavailable",
        "UNI chưa đọc được tệp này lúc này, thử lại sau.",
        false,
        false,
      ],
      [
        "drive_unavailable",
        "Google Drive tạm thời không phản hồi. Thử lại sau ít phút.",
        false,
        false,
      ],
      [
        "ai_disabled",
        "AI chưa khả dụng trên workspace này.",
        false,
        false,
      ],
    ];

    for (const [code, expectedMessage, isFormatUnsupported, isAccessRequired] of cases) {
      const res = resolveDriveProposalError(
        new ApiError("err", code, 409),
        t,
      );
      expect(res.message).toBe(expectedMessage);
      expect(res.isFormatUnsupported).toBe(isFormatUnsupported);
      expect(res.isAccessRequired).toBe(isAccessRequired);
    }
  });

  it("renders prompt hint chips in popover, inserts into empty and non-empty prompt, focuses textarea at end, sends in B5 request, and hides when gated (UNI-2219)", async () => {
    const slowGate = Promise.withResolvers<{ proposal: DriveTaskProposal }>();
    let callCount = 0;

    requestMock.mockImplementation(
      async (path: string, init?: { method?: string }) => {
        if (path.endsWith("/ai/capabilities")) return { enabled: true };
        if (
          path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
          init?.method === "POST"
        ) {
          callCount += 1;
          if (callCount === 1) return slowGate.promise;
          throw new ApiError("access required", "drive_access_required", 403);
        }
        return {};
      },
    );

    const onReviewOpen = vi.fn();
    render(
      renderInWorkspace(
        <DriveProposalReviewProvider onOpen={onReviewOpen}>
          <DriveProposeTasksPopover workspaceId="ws1" driveFileId="df_1" />
        </DriveProposalReviewProvider>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Tạo việc từ tài liệu" }));

    const promptInput = (await screen.findByLabelText(
      "Gợi ý cho UNI (tùy chọn)",
    )) as HTMLTextAreaElement;
    expect(promptInput).toHaveAttribute(
      "placeholder",
      "Ví dụ: người phụ trách, hạn hoàn thành, độ ưu tiên hoặc phạm vi cần lấy…",
    );

    const hintsGroup = screen.getByRole("group", { name: "Gợi ý mẫu cho UNI" });
    const chip1 = within(hintsGroup).getByRole("button", {
      name: "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này",
    });
    const chip3 = within(hintsGroup).getByRole("button", {
      name: "Ưu tiên cao cho việc gấp",
    });
    expect(hintsGroup.className).toContain("flex-wrap");
    expect(chip1.className).toContain("w-auto");
    expect(chip1.className).toContain("max-w-full");

    // Click into empty prompt -> inserts, focuses, caret at end
    fireEvent.click(chip1);
    expect(promptInput.value).toBe(
      "Giao cho người phụ trách ghi trong tài liệu, hạn trong tuần này",
    );
    expect(document.activeElement).toBe(promptInput);
    expect(promptInput.selectionStart).toBe(promptInput.value.length);
    expect(promptInput.selectionEnd).toBe(promptInput.value.length);

    // Type additional text and click another chip -> appends with separator, keeps typed text
    fireEvent.change(promptInput, { target: { value: "Lấy phần Mobile" } });
    fireEvent.click(chip3);
    expect(promptInput.value).toBe("Lấy phần Mobile. Ưu tiên cao cho việc gấp");
    expect(document.activeElement).toBe(promptInput);
    expect(promptInput.selectionStart).toBe(promptInput.value.length);

    // Submit -> while reading, hint chips are hidden
    fireEvent.click(screen.getByRole("button", { name: "Gửi cho agent" }));
    expect(await screen.findByText("UNI đang đọc tài liệu…")).toBeInTheDocument();
    expect(screen.queryByTestId("drive-prompt-hints")).toBeNull();

    await act(async () => {
      slowGate.resolve({ proposal: makeProposal({ id: "dtp_pop_hints" }) });
    });

    await waitFor(() => {
      expect(onReviewOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dtp_pop_hints" }),
      );
    }, QUERY_WAIT_OPTIONS);
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          prompt: "Lấy phần Mobile. Ưu tiên cao cho việc gấp",
        }),
      }),
    );

    // Re-open popover and trigger access-blocked error -> hint chips hidden
    fireEvent.click(screen.getByRole("button", { name: "Tạo việc từ tài liệu" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gửi cho agent" }));
    expect(
      await screen.findByText(
        "Bạn chưa cho UniWork đọc tệp này. Hãy cấp quyền đọc tệp trước khi tạo việc.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("drive-prompt-hints")).toBeNull();

    // English locale copy check (F4, F5)
    await act(async () => {
      await setLocale("en");
    });
    expect(t("drive.proposals.prompt_hints.assignee_deadline")).toBe(
      "Assign to the owner named in the document, due this week",
    );
    expect(t("drive.proposals.prompt_hints.scope")).toBe(
      "Only take tasks for the BE team",
    );
    expect(t("drive.proposals.prompt_hints.priority")).toBe(
      "Set high priority for urgent items",
    );
  });
});
