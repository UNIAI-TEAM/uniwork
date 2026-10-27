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
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DriveProposeTasksPopover, useDriveProposalReview } from "../drive-task-proposal-popover";
import {
  DriveProposalReviewDialog,
  DriveProposalReviewHost,
  buildBatchCreateItems,
  buildDriveProposalTaskDescription,
  createItemDraftsFromProposal,
  resolveDriveProposalCreateError,
} from "./index";

const toastNeutral = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const isMobileState = vi.hoisted(() => ({ value: false }));

vi.mock("sonner", () => ({
  toast: Object.assign(toastNeutral, { error: toastError, success: toastSuccess }),
}));

vi.mock("@uniwork/ui/hooks/use-mobile", () => ({
  useIsMobile: () => isMobileState.value,
  useIsCompact: () => isMobileState.value,
}));

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

function renderInWorkspace(ui: React.ReactElement, nav = fakeNav()) {
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
    nav,
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
    sharing_state: "private",
    connection_id: "dc_1",
    reader_account_email: "uni-work1@gmail.com",
    requested_by: "u1",
    prompt: "Chia việc",
    project_id: "p_1",
    parent_task_id: "t_1042",
    context_task_id: "t_1042",
    truncated: true,
    status: "ready",
    items: [
      {
        index: 0,
        title: "Chốt phạm vi tính năng beta",
        assignee_member_id: "u_lan",
        assignee_basis: 'Tài liệu: "Lan chốt phạm vi"',
        assignee_drive_access: "granted",
        priority: "high",
        priority_basis: "Chặn các việc sau",
        start_date: "2026-10-27",
        start_basis: "",
        due_date: "2026-11-05",
        due_basis: 'Mục 3: "trước 05/11"',
        label_ids: ["lbl_prod"],
        label_basis: "Mục sản phẩm",
        goal: "Chốt danh sách tính năng vào bản beta nội bộ ngày 10/11.",
        checklist: [
          "Liệt kê tính năng ứng viên",
          "Họp chốt với nhóm sản phẩm",
        ],
        excerpt: {
          section: "Mục 2",
          quote: "Nhóm sản phẩm chốt phạm vi beta trước 05/11.",
        },
        blocked_by_indexes: [],
      },
      {
        index: 1,
        title: "Soạn FAQ cho CS",
        assignee_member_id: "u_mai",
        assignee_drive_access: "unknown",
        priority: "low",
        label_ids: [],
        goal: "Bộ câu hỏi thường gặp cho CS dùng khi ra mắt.",
        checklist: ["Gom câu hỏi về giá và gói"],
        excerpt: {
          section: "Mục 2",
          quote: "CS soạn FAQ…",
        },
        blocked_by_indexes: [0],
        possible_duplicate: {
          task_id: "t_1037",
          identifier: "UNI-1037",
          title: "Soạn FAQ sản phẩm",
        },
      },
    ],
    tasks_created: {
      count: 4,
      last_created_at: "2026-10-26T09:58:00Z",
      last_created_by_name: "Lan",
    },
    prior_creations: [
      {
        proposal_id: "dtp_prior",
        created_at: "2026-10-26T09:58:00Z",
        created_by_id: "u_lan",
        created_by_name: "Lan",
        tasks: [
          {
            task_id: "t_1051",
            identifier: "UNI-1051",
            title: "Việc trước",
            status: "todo",
          },
        ],
      },
    ],
    created_at: "2026-10-26T10:00:00Z",
    expires_at: "2026-11-02T10:00:00Z",
    ...overrides,
  };
}

function defaultMockRoutes(path: string) {
  if (path.endsWith("/projects")) {
    return {
      projects: [
        { id: "p_1", title: "Ra mắt sản phẩm Q4" },
        { id: "p_2", title: "Tăng trưởng Q1" },
      ],
      total: 2,
    };
  }
  if (path.endsWith("/tasks")) {
    return {
      tasks: [
        {
          id: "t_1042",
          workspace_id: "ws1",
          identifier: "UNI-1042",
          title: "Chuẩn bị kế hoạch ra mắt",
          description: "",
          status: "todo",
          priority: "high",
          position: 1,
          created_by: "u1",
          created_at: "2026-10-26T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
        {
          id: "t_2000",
          workspace_id: "ws1",
          identifier: "UNI-2000",
          title: "Kế hoạch dự phòng",
          description: "",
          status: "todo",
          priority: "medium",
          position: 2,
          created_by: "u1",
          created_at: "2026-10-26T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
    };
  }
  if (path.endsWith("/ai/capabilities")) {
    return { enabled: true };
  }
  if (path.endsWith("/task-labels") || path.endsWith("/labels")) {
    return {
      labels: [
        {
          id: "lbl_prod",
          organization_id: "o1",
          workspace_id: "ws1",
          name: "Sản phẩm",
          description: "",
          color: "#2563EB",
          usage_count: 1,
          created_at: "2026-10-26T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
        {
          id: "lbl_risk",
          organization_id: "o1",
          workspace_id: "ws1",
          name: "Rủi ro",
          description: "",
          color: "#DC2626",
          usage_count: 0,
          created_at: "2026-10-26T00:00:00Z",
          updated_at: "2026-10-26T00:00:00Z",
        },
      ],
      total: 2,
    };
  }
  if (path.endsWith("/members")) {
    return {
      members: [
        {
          workspace_id: "ws1",
          user_id: "u_lan",
          display_name: "Lan",
          email: "lan@vietants.vn",
          role: "member",
        },
        {
          workspace_id: "ws1",
          user_id: "u_mai",
          display_name: "Mai",
          email: "mai@vietants.vn",
          role: "member",
        },
      ],
    };
  }
  if (path.endsWith("/agents")) {
    return { agents: [] };
  }
  if (path.endsWith("/task-statuses")) {
    return {
      statuses: [
        {
          id: "st_todo",
          key: "todo",
          name: "Cần làm",
          category: "todo",
          position: 1,
          is_system: true,
          customized: false,
        },
        {
          id: "st_prog",
          key: "in_progress",
          name: "Đang làm",
          category: "in_progress",
          position: 2,
          is_system: true,
          customized: false,
        },
      ],
    };
  }
  return {};
}

describe("DriveProposalReviewDialog & helpers (W7, spec §7.10, §8.4–§8.8)", () => {
  beforeEach(async () => {
    await setLocale("vi");
    isMobileState.value = false;
    toastNeutral.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    requestMock.mockImplementation(async (path: string) => defaultMockRoutes(path));
    resetAuthStoreForTests();
    setSessionUser(defaultUser);
  });

  it("renders loading state when opened with proposalId before proposal loads, then renders ready items, basis lines, blocked-by badge, assignee access notice, and prior creations row", async () => {
    const proposalGate = Promise.withResolvers<{ proposal: DriveTaskProposal }>();
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1") {
        return proposalGate.promise;
      }
      return defaultMockRoutes(path);
    });

    render(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          proposalId="dtp_1"
        />,
      ),
    );

    expect(screen.getByTestId("drive-proposal-review-loading")).toHaveTextContent(
      "Đang tải đề xuất…",
    );

    await act(async () => {
      proposalGate.resolve({ proposal: makeProposal() });
    });

    expect(
      await screen.findByRole(
        "heading",
        { name: "UNI đề xuất 2 việc từ tài liệu" },
        QUERY_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("drive-proposal-private-badge")).toHaveTextContent(
      "Riêng tư trên Google Drive",
    );
    expect(screen.getByTestId("drive-proposal-truncated-badge")).toHaveTextContent(
      "UNI chỉ đọc phần đầu tài liệu",
    );
    expect(screen.getByTestId("drive-proposal-prior-creations")).toHaveTextContent(
      "Đã tạo 4 việc từ tài liệu này trước đây",
    );

    // Basis lines with "UNI · " prefix and text-warning token
    const basisNodes = screen.getAllByTestId("drive-proposal-basis");
    expect(basisNodes.length).toBeGreaterThanOrEqual(3);
    expect(basisNodes[0]).toHaveTextContent('UNI · Tài liệu: "Lan chốt phạm vi"');
    expect(basisNodes[0]).toHaveClass("text-warning");

    // Blocked by badge on item 1
    expect(screen.getByTestId("drive-proposal-blocked-by-1")).toHaveTextContent(
      "Bị chặn bởi: Chốt phạm vi tính năng beta",
    );

    // F1: Labels caption and trigger aria-label render translated text ("Nhãn"), never raw key "tasks.detail.labels"
    const item0 = screen.getByTestId("drive-proposal-item-0");
    expect(within(item0).getByText("Nhãn")).toBeInTheDocument();
    expect(
      await within(item0).findByRole("button", { name: "Nhãn: Sản phẩm" }, QUERY_WAIT_OPTIONS),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tasks\.detail\.labels/)).toBeNull();

    // F2: Assignee trigger renders avatar + name when assigned, and "Chưa giao" with accessible name when unassigned
    const assigneeBtn0 = within(item0).getByRole("button", { name: "Người phụ trách: Lan" });
    expect(assigneeBtn0).toHaveTextContent("Lan");
    fireEvent.click(assigneeBtn0);
    fireEvent.click(await screen.findByRole("button", { name: "Chưa giao" }));
    const unassignedBtn0 = await within(item0).findByRole("button", {
      name: "Người phụ trách: Chưa giao",
    });
    expect(unassignedBtn0).toHaveTextContent("Chưa giao");

    // F6: Per-item switch hit area class and 44x44 wrapper
    const switch0 = within(item0).getByRole("switch", {
      name: "Tạo việc: Chốt phạm vi tính năng beta",
    });
    expect(switch0).toHaveClass("after:-inset-y-4");
    expect(switch0.parentElement).toHaveClass("min-h-11", "min-w-11");

    // Assignee without Drive access notice on item 1 (Mai has assignee_drive_access = unknown)
    expect(
      await screen.findByTestId("drive-proposal-assignee-access-1", {}, QUERY_WAIT_OPTIONS),
    ).toHaveTextContent(
      "Mai chưa xem được tài liệu trên Google Drive. Sau khi tạo, Mai thấy việc và tên tài liệu, kèm nút mở tài liệu trên Google Drive để xin quyền chủ sở hữu.",
    );

    // Expand description on item 0 -> shows goal, checklist, and excerpt link
    const descBtn = within(item0).getByRole("button", { name: /Mô tả/ });
    expect(descBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(descBtn);
    expect(descBtn).toHaveAttribute("aria-expanded", "true");
    expect(within(item0).getByTestId("drive-proposal-excerpt-0")).toHaveTextContent(
      'Nguồn: Mục 2: "Nhóm sản phẩm chốt phạm vi beta trước 05/11."',
    );
  });

  it("toggles items off, disables submit via aria-disabled with 'Chọn ít nhất 1 việc', and resolves duplicates both ways (Bỏ việc này / Vẫn tạo)", async () => {
    render(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          proposal={makeProposal()}
        />,
      ),
    );

    const submitBtn = await screen.findByTestId("drive-proposal-submit");
    expect(submitBtn).toHaveTextContent("Tạo 2 việc");
    expect(submitBtn).not.toHaveAttribute("aria-disabled");

    // Duplicate warning on item 1: click "Bỏ việc này" -> item 1 turns off, count becomes 1
    const dupBox = screen.getByTestId("drive-proposal-duplicate-1");
    expect(dupBox).toHaveTextContent("Có thể trùng với UNI-1037 · Soạn FAQ sản phẩm đang mở.");
    fireEvent.click(within(dupBox).getByRole("button", { name: "Bỏ việc này" }));

    expect(submitBtn).toHaveTextContent("Tạo 1 việc");
    expect(screen.getByTestId("drive-proposal-item-1")).toHaveAttribute("data-selected", "false");

    // Turn item 0 off via switch -> all items off
    const switch0 = screen.getByRole("switch", {
      name: "Tạo việc: Chốt phạm vi tính năng beta",
    });
    fireEvent.click(switch0);

    expect(submitBtn).toHaveTextContent("Chọn ít nhất 1 việc");
    expect(submitBtn).toHaveAttribute("aria-disabled", "true");
    expect(submitBtn).not.toBeDisabled();

    // Clicking "Vẫn tạo" on item 1 re-enables item 1 with allow_duplicate = true
    fireEvent.click(within(dupBox).getByRole("button", { name: "Vẫn tạo" }));
    expect(submitBtn).toHaveTextContent("Tạo 1 việc");
    expect(screen.getByTestId("drive-proposal-item-1")).toHaveAttribute("data-selected", "true");
    expect(dupBox).toHaveTextContent("Đã chọn Vẫn tạo dù trùng tiêu đề.");
  });

  it("recomputes duplicates via POST .../duplicates when batch project or parent task changes", async () => {
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (
        path === "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1/duplicates" &&
        init?.method === "POST"
      ) {
        return {
          duplicates: [
            {
              index: 0,
              possible_duplicate: {
                task_id: "t_999",
                identifier: "UNI-999",
                title: "Phạm vi beta cũ",
              },
            },
            {
              index: 1,
            },
          ],
        };
      }
      return defaultMockRoutes(path);
    });

    render(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          proposal={makeProposal()}
        />,
      ),
    );

    const batchSection = await screen.findByRole("region", { name: "Áp dụng cho cả lô" });
    // Clear the project using the clear button inside batchSection
    const clearBtns = within(batchSection).getAllByRole("button", { name: "Xóa" });
    fireEvent.click(clearBtns[0]!);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1/duplicates",
        expect.objectContaining({
          method: "POST",
          body: {
            project_id: null,
            parent_task_id: "t_1042",
            titles: ["Chốt phạm vi tính năng beta", "Soạn FAQ cho CS"],
          },
        }),
      );
    }, QUERY_WAIT_OPTIONS);

    // Item 0 now has the new duplicate warning, and item 1's duplicate is cleared
    expect(
      await screen.findByTestId("drive-proposal-duplicate-0", {}, QUERY_WAIT_OPTIONS),
    ).toHaveTextContent(
      "UNI-999 · Phạm vi beta cũ",
    );
    expect(screen.queryByTestId("drive-proposal-duplicate-1")).toBeNull();

    // F10: Clearing parent task removes the clear (×) button when parent is empty
    const clearRemainingBtns = within(batchSection).getAllByRole("button", { name: "Xóa" });
    expect(clearRemainingBtns).toHaveLength(1);
    fireEvent.click(clearRemainingBtns[0]!);
    expect(within(batchSection).queryByRole("button", { name: "Xóa" })).toBeNull();
  });

  it("asks confirmation before discarding proposal, calls DELETE on confirm, and closes dialog", async () => {
    const onOpenChange = vi.fn();
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (
        path === "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1" &&
        init?.method === "DELETE"
      ) {
        return { status: "ok" };
      }
      return defaultMockRoutes(path);
    });

    render(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={onOpenChange}
          proposal={makeProposal()}
        />,
      ),
    );

    const cancelBtn = await screen.findByRole("button", { name: "Hủy" });
    fireEvent.click(cancelBtn);

    expect(await screen.findByText("Bỏ đề xuất này?")).toBeInTheDocument();
    expect(screen.getByText("UNI sẽ không giữ lại danh sách.")).toBeInTheDocument();

    // Choosing "Ở lại" keeps the dialog open without calling DELETE
    fireEvent.click(screen.getByRole("button", { name: "Ở lại" }));
    expect(onOpenChange).not.toHaveBeenCalled();

    // Click Hủy again and confirm "Bỏ đề xuất"
    fireEvent.click(cancelBtn);
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ đề xuất" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1",
        expect.objectContaining({ method: "DELETE" }),
      );
    }, QUERY_WAIT_OPTIONS);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits exact B6 batch payload, shows toast with parent link 'Xem UNI-1042', and navigates via useNavigation()", async () => {
    const nav = fakeNav();
    const onOpenChange = vi.fn();
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (
        path === "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1/tasks" &&
        init?.method === "POST"
      ) {
        return {
          task_ids: ["t_new_1", "t_new_2"],
          items: [
            { index: 0, task_id: "t_new_1" },
            { index: 1, task_id: "t_new_2" },
          ],
        };
      }
      return defaultMockRoutes(path);
    });

    render(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={onOpenChange}
          proposal={makeProposal()}
        />,
        nav,
      ),
    );

    // Wait for tasksQuery to resolve so UNI-1042 identifier is loaded
    await screen.findByText(/UNI-1042 · Chuẩn bị kế hoạch ra mắt/, {}, QUERY_WAIT_OPTIONS);

    // Mark item 1 duplicate as "Vẫn tạo"
    const dupBox = screen.getByTestId("drive-proposal-duplicate-1");
    fireEvent.click(within(dupBox).getByRole("button", { name: "Vẫn tạo" }));

    // Edit item 0 title
    const titleInput0 = screen.getByRole("textbox", { name: "Tiêu đề việc 1" });
    fireEvent.change(titleInput0, { target: { value: "Chốt phạm vi beta (đã duyệt)" } });

    const submitBtn = screen.getByTestId("drive-proposal-submit");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1/tasks",
        expect.objectContaining({
          method: "POST",
          body: {
            project_id: "p_1",
            parent_task_id: "t_1042",
            status: "todo",
            items: [
              {
                index: 0,
                title: "Chốt phạm vi beta (đã duyệt)",
                description: expect.stringContaining(
                  "**Mục tiêu:** Chốt danh sách tính năng vào bản beta nội bộ ngày 10/11.",
                ),
                assignee_id: "u_lan",
                priority: "high",
                start_date: "2026-10-27",
                due_date: "2026-11-05",
                label_ids: ["lbl_prod"],
                blocked_by_indexes: [],
                allow_duplicate: false,
              },
              {
                index: 1,
                title: "Soạn FAQ cho CS",
                description: expect.stringContaining(
                  'Nguồn: Mục 2: "CS soạn FAQ…" · [Kế hoạch ra mắt Q4](/acme/team/documents/drive/df_1)',
                ),
                assignee_id: "u_mai",
                priority: "low",
                start_date: null,
                due_date: null,
                label_ids: [],
                blocked_by_indexes: [0],
                allow_duplicate: true,
              },
            ],
          },
        }),
      );
    }, QUERY_WAIT_OPTIONS);

    expect(toastSuccess).toHaveBeenCalledWith(
      "Đã tạo 2 việc từ Kế hoạch ra mắt Q4, là sub-task của UNI-1042",
      expect.objectContaining({
        action: expect.objectContaining({
          label: "Xem UNI-1042",
        }),
      }),
    );

    const toastOpts = toastSuccess.mock.calls[0]?.[1] as {
      action: { onClick: () => void };
    };
    toastOpts.action.onClick();
    expect(nav.push).toHaveBeenCalledWith("/acme/team/tasks/t_1042");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders converted, discarded, and expired proposal states and maps every B6 error code to copy", async () => {
    const { rerender } = render(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          proposal={makeProposal({ status: "converted" })}
        />,
      ),
    );
    expect(await screen.findByTestId("drive-proposal-state-converted")).toHaveTextContent(
      "Đề xuất này đã được tạo thành công việc.",
    );

    rerender(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          proposal={makeProposal({ status: "discarded" })}
        />,
      ),
    );
    expect(await screen.findByTestId("drive-proposal-state-discarded")).toHaveTextContent(
      "Đề xuất này đã bị hủy.",
    );

    rerender(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={() => {}}
          proposal={makeProposal({
            status: "ready",
            expires_at: "2020-01-01T00:00:00Z",
          })}
        />,
      ),
    );
    expect(await screen.findByTestId("drive-proposal-state-expired")).toHaveTextContent(
      "Đề xuất này đã hết hạn.",
    );

    // Error code mapping unit checks
    const cases: Array<[unknown, string]> = [
      [
        new ApiError("not ready", "proposal_not_ready", 409),
        "Đề xuất này đã được tạo việc hoặc đã hủy.",
      ],
      [
        new ApiError("expired", "proposal_expired", 410),
        "Đề xuất này đã hết hạn.",
      ],
      [
        new ApiError("converted", "proposal_item_already_converted", 409),
        "Một hoặc nhiều việc trong đề xuất đã được tạo trước đó.",
      ],
      [
        new ApiError("dup", "active_duplicate_task", 409),
        "Có việc đang mở trùng tiêu đề trong cùng dự án và task cha. Hãy chọn Vẫn tạo hoặc Bỏ việc này.",
      ],
      [
        new ApiError("source changed", "drive_source_changed", 409),
        "Tài liệu vừa thay đổi kết nối hoặc bị bỏ liên kết.",
      ],
      [
        new ApiError("access", "drive_access_required", 409),
        "Bạn chưa cho UniWork đọc tệp này. Hãy cấp quyền đọc tệp trước khi tạo việc.",
      ],
      [
        new ApiError("grant", "drive_grant_required", 403),
        "Bạn chưa cấp cho UniWork quyền đọc tệp này. Chọn lại tệp trong Google Picker rồi thử lại.",
      ],
      [
        new ApiError("not accessible", "drive_file_not_accessible", 404),
        "Tài khoản Google Drive của bạn không còn quyền với tệp này.",
      ],
      [
        new ApiError("unavailable", "drive_unavailable", 503),
        "Google Drive tạm thời không phản hồi. Thử lại sau ít phút.",
      ],
      [
        new ApiError("auth", "auth_failed", 401),
        "Kết nối Google Drive đã hết hạn. Kết nối lại rồi thử lại.",
      ],
      [
        new ApiError("admin", "blocked_by_workspace_admin", 403),
        "Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive.",
      ],
      [
        new ApiError("quota", "quota_exceeded", 402),
        "Tổ chức đã hết hạn mức số lượng task của gói hiện tại.",
      ],
      [
        new ApiError("disabled", "feature_disabled", 404),
        "AI chưa khả dụng trên workspace này.",
      ],
      [
        new ApiError("rate", "rate_limited", 429),
        "Bạn đã nhờ UNI đọc tài liệu nhiều lần. Thử lại sau ít phút.",
      ],
      [
        new ApiError("unknown", "unexpected_code", 500),
        "Không tạo được việc từ đề xuất. Thử lại.",
      ],
    ];

    for (const [err, expectedMessage] of cases) {
      expect(resolveDriveProposalCreateError(err, t).message).toBe(expectedMessage);
    }
  });

  it("displays B6 error alert inside dialog on failed submit and mounts via DriveProposalReviewHost on mobile (Sheet)", async () => {
    isMobileState.value = true;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (
        path === "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1/tasks" &&
        init?.method === "POST"
      ) {
        throw new ApiError("dup", "active_duplicate_task", 409);
      }
      return defaultMockRoutes(path);
    });

    function Trigger() {
      const review = useDriveProposalReview();
      return (
        <button
          type="button"
          onClick={() => {
            review.open(makeProposal());
          }}
        >
          Mở hộp duyệt
        </button>
      );
    }

    render(
      renderInWorkspace(
        <DriveProposalReviewHost workspaceId="ws1">
          <Trigger />
        </DriveProposalReviewHost>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Mở hộp duyệt" }));
    expect(
      await screen.findByRole("heading", { name: "UNI đề xuất 2 việc từ tài liệu" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("drive-proposal-submit"));

    const errorAlert = await screen.findByTestId("drive-proposal-create-error");
    expect(errorAlert).toHaveTextContent(
      "Có việc đang mở trùng tiêu đề trong cùng dự án và task cha. Hãy chọn Vẫn tạo hoặc Bỏ việc này.",
    );
    // F3: Error alert sits inside the pinned footer beside the submit button and receives focus
    const submitBtn = screen.getByTestId("drive-proposal-submit");
    expect(submitBtn.parentElement?.parentElement?.parentElement).toContainElement(errorAlert);
    await waitFor(() => {
      expect(document.activeElement).toBe(errorAlert);
    });
    expect(screen.getByTestId("drive-proposal-live-region")).toHaveTextContent(
      "Có việc đang mở trùng tiêu đề trong cùng dự án và task cha. Hãy chọn Vẫn tạo hoặc Bỏ việc này.",
    );
  });

  it("builds description and filters blocked_by_indexes to items included in the batch", () => {
    const proposal = makeProposal();
    const drafts = createItemDraftsFromProposal(proposal.items);
    const desc0 = buildDriveProposalTaskDescription(
      drafts[0]!,
      proposal.drive_file_name,
      "/acme/team/documents/drive/df_1",
      t,
    );
    expect(desc0).toContain("**Mục tiêu:** Chốt danh sách tính năng vào bản beta nội bộ ngày 10/11.");
    expect(desc0).toContain("- [ ] Liệt kê tính năng ứng viên");
    expect(desc0).toContain(
      'Nguồn: Mục 2: "Nhóm sản phẩm chốt phạm vi beta trước 05/11." · [Kế hoạch ra mắt Q4](/acme/team/documents/drive/df_1)',
    );

    // If item 0 is deselected, item 1's blocked_by_indexes ([0]) is filtered out
    drafts[0]!.selected = false;
    const batchItems = buildBatchCreateItems(
      drafts,
      proposal.drive_file_name,
      "/acme/team/documents/drive/df_1",
      t,
    );
    expect(batchItems).toHaveLength(1);
    expect(batchItems[0]?.index).toBe(1);
    expect(batchItems[0]?.blocked_by_indexes).toEqual([]);
  });

  it("shows neutral unconfirmed toast before closing when B6 create returns 2xx with null/empty body (F4)", async () => {
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (
        path === "/api/v1/workspaces/ws1/drive-task-proposals/dtp_1/tasks" &&
        init?.method === "POST"
      ) {
        return { unexpected: "shape" };
      }
      return defaultMockRoutes(path);
    });

    const onOpenChange = vi.fn();
    render(
      renderInWorkspace(
        <DriveProposalReviewDialog
          workspaceId="ws1"
          open
          onOpenChange={onOpenChange}
          proposal={makeProposal({
            items: [
              {
                index: 0,
                title: "Chốt phạm vi beta",
                label_ids: [],
                goal: "Mục tiêu",
                checklist: [],
                excerpt: { section: "Mục 1", quote: "Trích dẫn" },
                blocked_by_indexes: [],
              },
            ],
          })}
        />,
      ),
    );

    fireEvent.click(await screen.findByTestId("drive-proposal-submit"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }, QUERY_WAIT_OPTIONS);
    expect(toastNeutral).toHaveBeenCalledWith(
      "Chưa xác nhận được việc đã tạo, kiểm tra lại danh sách.",
    );
    expect(screen.queryByTestId("drive-proposal-create-error")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("completes end-to-end flow: DriveProposeTasksPopover inside DriveProposalReviewHost (isMounted=true) -> B5 POST -> open(proposal) -> renders DriveProposalReviewDialog", async () => {
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (
        path === "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals" &&
        init?.method === "POST"
      ) {
        return { proposal: makeProposal({ id: "dtp_e2e_1" }) };
      }
      return defaultMockRoutes(path);
    });

    let capturedIsMounted = false;
    function MountProbe() {
      const review = useDriveProposalReview();
      capturedIsMounted = review.isMounted;
      return null;
    }

    render(
      renderInWorkspace(
        <DriveProposalReviewHost workspaceId="ws1">
          <MountProbe />
          <DriveProposeTasksPopover
            workspaceId="ws1"
            driveFileId="df_1"
            readerAccountEmail="uni-work1@gmail.com"
            openUrl="https://docs.google.com/document/d/gdoc_1/edit"
          />
        </DriveProposalReviewHost>,
      ),
    );

    expect(capturedIsMounted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Tạo việc từ tài liệu" }));
    const promptInput = await screen.findByLabelText("Gợi ý cho UNI (tùy chọn)");
    fireEvent.change(promptInput, { target: { value: "Tách việc theo nhóm" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi cho agent" }));

    expect(
      await screen.findByRole(
        "heading",
        { name: "UNI đề xuất 2 việc từ tài liệu" },
        QUERY_WAIT_OPTIONS,
      ),
    ).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files/df_1/task-proposals",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ prompt: "Tách việc theo nhóm" }),
      }),
    );
    expect(screen.getByRole("textbox", { name: "Tiêu đề việc 1" })).toHaveValue(
      "Chốt phạm vi tính năng beta",
    );
  });
});
