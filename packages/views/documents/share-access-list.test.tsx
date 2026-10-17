import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentAccess } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { ShareAccessList } from "./share-access-list";

initI18n();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const memberLabels = new Map<string, string>([
  ["u1", "Trần Chủ (owner@acme.vn)"],
  ["u2", "Nguyễn An (an@acme.vn)"],
  ["u3", "Lê Bình (binh@acme.vn)"],
]);

const workspaceNames = new Map<string, string>([
  ["w1", "Kinh doanh"],
  ["w2", "Kỹ thuật"],
]);

function renderAccessList(
  access: DocumentAccess,
  opts: { canManage?: boolean; adminScope?: boolean; canTransfer?: boolean } = {},
) {
  return render(
    wrap(
      <ShareAccessList
        wsId="w1"
        docId="d1"
        docWorkspaceId="w1"
        access={access}
        canManage={opts.canManage ?? true}
        adminScope={opts.adminScope ?? false}
        canTransfer={opts.canTransfer ?? false}
        ownedByWorkProduct={false}
        onOpenTransfer={vi.fn()}
        memberLabels={memberLabels}
        workspaceNames={workspaceNames}
        organization={{ id: "o1", name: "Acme" }}
        locale="vi"
      />,
    ),
  );
}

describe("ShareAccessList (SH-W1 Area 2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.clearAllMocks();
  });

  it("AC06/AC12: renders home workspace row with Nơi lưu badge, direct_below_group warning line, and expandable sources", async () => {
    const user = userEvent.setup();
    renderAccessList({
      my_level: "manage",
      via: "member",
      acl_owner: { user_id: "u1", level: "manage", via: "member" },
      home_workspace: { workspace_id: "w1", workspace_name: "Kinh doanh", level: "edit" },
      shares: [
        {
          id: "s1",
          principal_type: "user",
          principal_id: "u2",
          level: "view",
          active: true,
          effective_level: "edit",
          effective_via: "member",
          sources: [
            { via: "share", principal_type: "user", principal_id: "u2", level: "view" },
            { via: "member", principal_type: "workspace", principal_id: "w1", level: "edit" },
          ],
          warnings: ["direct_below_group"],
          granted_by: "u1",
          granted_by_kind: "human",
          created_at: "2026-10-15T09:00:00Z",
        },
        {
          id: "s2",
          principal_type: "organization",
          principal_id: "o1",
          level: "view",
          active: true,
          granted_by: "u1",
          granted_by_kind: "human",
          created_at: "2026-10-15T09:00:00Z",
        },
      ],
    });

    expect(screen.getByText("Chủ sở hữu")).toBeInTheDocument();
    expect(screen.getByText("Workspace Kinh doanh")).toBeInTheDocument();
    expect(screen.getByText("Nơi lưu")).toBeInTheDocument();
    expect(screen.getByText(/Quyền thực tế: Chỉnh sửa/)).toBeInTheDocument();

    const warningLine = screen.getByTestId("warning-direct-below-group-u2");
    expect(warningLine).toHaveTextContent(
      "Nguyễn An (an@acme.vn) vẫn có quyền Chỉnh sửa qua Workspace Kinh doanh",
    );

    await user.click(screen.getByRole("button", { name: "Nguồn quyền (2)" }));
    expect(screen.getByText("Chỉ xem qua chia sẻ trực tiếp")).toBeInTheDocument();
    expect(screen.getByText("Chỉnh sửa qua Workspace Kinh doanh")).toBeInTheDocument();

    // Q-S1: Home workspace and Organization rows do NOT offer "Quản lý" in their level Select.
    await user.click(screen.getByRole("combobox", { name: "Mức quyền Kinh doanh" }));
    expect(screen.queryByRole("option", { name: "Quản lý" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Chỉnh sửa" })).toBeInTheDocument();
  });

  it("AC07: revoking a person who keeps group access shows FR-09 sentence and fires past-tense toast on confirm", async () => {
    const accessCalls: Array<{ items: unknown[]; dry_run?: boolean }> = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        accessCalls.push(opts.body);
        return Promise.resolve({
          batch_id: opts.body.dry_run ? "" : "01JREV1",
          dry_run: Boolean(opts.body.dry_run),
          results: [{ index: 0, status: "revoked" }],
          preview: {
            users: [
              {
                user_id: "u2",
                before: { level: "edit", via: "share" },
                after: { level: "view", via: "member" },
              },
            ],
            groups: [],
            warnings: [],
          },
        });
      }
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    renderAccessList({
      my_level: "manage",
      via: "member",
      home_workspace: { workspace_id: "w1", workspace_name: "Kinh doanh", level: "view" },
      shares: [
        {
          id: "s1",
          principal_type: "user",
          principal_id: "u2",
          level: "edit",
          active: true,
          granted_by: "u1",
          granted_by_kind: "human",
          created_at: "2026-10-15T09:00:00Z",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Thu hồi Nguyễn An (an@acme.vn)" }));

    const confirmBox = await screen.findByTestId("share-access-confirm");
    expect(confirmBox).toHaveTextContent(
      "Thu hồi quyền chia sẻ trực tiếp của Nguyễn An (an@acme.vn)? Nguyễn An (an@acme.vn) vẫn có quyền Chỉ xem qua Workspace Kinh doanh.",
    );
    expect(accessCalls).toHaveLength(1);
    expect(accessCalls[0]?.dry_run).toBe(true);

    await user.click(within(confirmBox).getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(accessCalls).toHaveLength(2));
    expect(accessCalls[1]).toEqual({
      items: [{ principal_type: "user", principal_id: "u2", level: null }],
      dry_run: false,
    });
    expect(toast.success).toHaveBeenCalledWith("Đã thu hồi quyền của Nguyễn An (an@acme.vn)");
  });

  it("U-SH4: non-manager view shows only caller's own access and my_sources without other people's rows", () => {
    renderAccessList(
      {
        my_level: "comment",
        via: "share",
        my_sources: [
          { via: "share", principal_type: "user", principal_id: "u2", level: "comment" },
          { via: "member", principal_type: "workspace", principal_id: "w1", level: "view" },
        ],
        shares: [
          {
            id: "s1",
            principal_type: "user",
            principal_id: "u3",
            level: "edit",
            active: true,
            granted_by: "u1",
            granted_by_kind: "human",
            created_at: "2026-10-15T09:00:00Z",
          },
        ],
      },
      { canManage: false, adminScope: false },
    );

    expect(screen.getByText("Quyền của bạn: Nhận xét")).toBeInTheDocument();
    expect(screen.getByText("Nhận xét qua chia sẻ trực tiếp")).toBeInTheDocument();
    expect(screen.getByText("Chỉ xem qua Workspace Kinh doanh")).toBeInTheDocument();
    expect(screen.queryByText(/Lê Bình/)).not.toBeInTheDocument();
  });
});
