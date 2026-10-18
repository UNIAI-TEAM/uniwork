import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentAccess } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { ShareAccessList } from "./share-access-list";

// review_fe r1 (UNI-1784 fe-fix-1) for the access list: F-W1-10, F-W1-12,
// F-W1-15 (Q-S1 on the list, inline change, group sentences) and E2E-2 (the
// toast is the preview sentence in the past tense).

const { t } = initI18n();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const memberLabels = new Map<string, string>([
  ["u1", "Trần Chủ"],
  ["u2", "Nguyễn An"],
]);
const workspaceNames = new Map<string, string>([
  ["w1", "Kinh doanh"],
  ["w2", "Kỹ thuật"],
]);

const row = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  principal_type: "user",
  principal_id: "u2",
  level: "view",
  active: true,
  granted_by: "u1",
  granted_by_kind: "human",
  created_at: "2026-10-15T09:00:00Z",
  ...over,
});

function access(shares: unknown[], over: Record<string, unknown> = {}): DocumentAccess {
  return { my_level: "manage", via: "member", shares, ...over } as DocumentAccess;
}

function tree(value: DocumentAccess) {
  return wrap(
    <ShareAccessList
      wsId="w1"
      docId="d1"
      docWorkspaceId="w1"
      access={value}
      canManage
      memberLabels={memberLabels}
      workspaceNames={workspaceNames}
      organization={{ id: "o1", name: "Acme" }}
      locale="vi"
    />,
  );
}

/** Answer PUT /access with `preview` and record every body. */
function serveAccess(preview: Record<string, unknown> = { users: [], groups: [], warnings: [] }) {
  const bodies: any[] = [];
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
    if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
      bodies.push(opts.body);
      return Promise.resolve({
        batch_id: opts.body.dry_run ? "" : "01JB",
        dry_run: Boolean(opts.body.dry_run),
        results: [{ index: 0, status: "updated" }],
        preview,
      });
    }
    return Promise.resolve({});
  });
  return bodies;
}

beforeEach(() => {
  requestMock.mockReset();
  vi.clearAllMocks();
});

describe("ShareAccessList review fixes", () => {
  it("Q-S1: an organization row offers no Quản lý in its level select", async () => {
    const user = userEvent.setup();
    render(tree(access([row({ id: "s2", principal_type: "organization", principal_id: "o1", level: "view" })])));

    await user.click(screen.getByRole("combobox", { name: `${t("documents.share.level_label")} Acme` }));
    // Wait for the popup first, so the absence check runs against rendered options.
    expect(await screen.findByRole("option", { name: t("documents.share.level_edit") })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: t("documents.share.level_manage") })).not.toBeInTheDocument();
  });

  it("F-W1-10: a filter typed over 20 rows stops hiding rows once revocations bring the list under 20", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 21 }, (_, i) => {
      const id = `u${100 + i}`;
      memberLabels.set(id, `Người ${String(i).padStart(2, "0")}`);
      return row({ id: `s${id}`, principal_id: id });
    });
    const { rerender } = render(tree(access(many)));

    const filter = screen.getByLabelText(t("documents.share.access_filter_label"));
    await user.type(filter, "Người 05");
    expect(screen.getByText("Người 05")).toBeInTheDocument();
    expect(screen.queryByText("Người 06")).not.toBeInTheDocument();

    rerender(tree(access(many.slice(0, 3))));
    expect(screen.queryByLabelText(t("documents.share.access_filter_label"))).toBeNull();
    expect(screen.getByText("Người 00")).toBeInTheDocument();
    expect(screen.getByText("Người 01")).toBeInTheDocument();
    expect(screen.getByText("Người 02")).toBeInTheDocument();
  });

  it("F-W1-12: an inactive row's level select is disabled, so it cannot re-grant the row", () => {
    render(tree(access([row({ active: false })])));
    expect(screen.getByRole("combobox", { name: `${t("documents.share.level_label")} Nguyễn An` })).toBeDisabled();
    expect(screen.getByText(t("documents.share.inactive"))).toBeInTheDocument();
  });

  it("changes a level in place: one dry_run, then the write without a confirm box when nothing warns", async () => {
    const bodies = serveAccess();
    const user = userEvent.setup();
    render(tree(access([row()])));

    await user.click(screen.getByRole("combobox", { name: `${t("documents.share.level_label")} Nguyễn An` }));
    await user.click(await screen.findByRole("option", { name: t("documents.share.level_edit") }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual({ items: [{ principal_type: "user", principal_id: "u2", level: "edit", on_existing: "update" }], dry_run: true });
    expect(bodies[1]).toEqual({ items: [{ principal_type: "user", principal_id: "u2", level: "edit", on_existing: "update" }], dry_run: false });
    expect(screen.queryByTestId("share-access-confirm")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      t("documents.share.updated_toast", { name: "Nguyễn An", level: t("documents.share.level_edit") }),
    );
  });

  it("words a workspace downgrade as the group sentence and toasts it in the past tense (E2E-2)", async () => {
    const bodies = serveAccess({
      users: [],
      groups: [{ principal_type: "workspace", principal_id: "w2", member_count: 12, losing_count: 3 }],
      warnings: [{ code: "downgrade", index: 0 }],
    });
    const user = userEvent.setup();
    render(tree(access([row({ id: "s3", principal_type: "workspace", principal_id: "w2", level: "edit" })])));

    await user.click(screen.getByRole("combobox", { name: `${t("documents.share.level_label")} Kỹ thuật` }));
    await user.click(await screen.findByRole("option", { name: t("documents.share.level_view") }));

    const box = await screen.findByTestId("share-access-confirm");
    expect(box).toHaveTextContent("Đổi quyền của Kỹ thuật từ Chỉnh sửa xuống Chỉ xem (12 thành viên bị ảnh hưởng)");
    await user.click(within(box).getByRole("button", { name: t("documents.share.confirm_accept") }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(toast.success).toHaveBeenCalledWith("Đã đổi quyền của Kỹ thuật từ Chỉnh sửa xuống Chỉ xem (12 thành viên bị ảnh hưởng)");
  });

  it("revoking a workspace names the members who lose access, and the toast says so in the past tense (E2E-2)", async () => {
    serveAccess({
      users: [],
      groups: [{ principal_type: "workspace", principal_id: "w2", member_count: 12, losing_count: 3 }],
      warnings: [],
    });
    const user = userEvent.setup();
    render(tree(access([row({ id: "s3", principal_type: "workspace", principal_id: "w2", level: "edit" })])));

    await user.click(screen.getByRole("button", { name: `${t("documents.share.revoke")} Kỹ thuật` }));
    const box = await screen.findByTestId("share-access-confirm");
    expect(box).toHaveTextContent("Thu hồi quyền của Kỹ thuật (12 thành viên)? 3 thành viên sẽ mất quyền mở tài liệu.");
    await user.click(within(box).getByRole("button", { name: t("documents.share.confirm_accept") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Đã thu hồi quyền của Kỹ thuật (12 thành viên). 3 thành viên đã mất quyền mở tài liệu."),
    );
  });

  it("revoking a person with no other source toasts that they can no longer open the document (E2E-2)", async () => {
    serveAccess({ users: [{ user_id: "u2", before: { level: "view", via: "share" }, after: { level: "", via: "" } }], groups: [], warnings: [] });
    const user = userEvent.setup();
    render(tree(access([row()])));

    await user.click(screen.getByRole("button", { name: `${t("documents.share.revoke")} Nguyễn An` }));
    await user.click(within(await screen.findByTestId("share-access-confirm")).getByRole("button", { name: t("documents.share.confirm_accept") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Đã thu hồi quyền của Nguyễn An. Nguyễn An không còn mở được tài liệu này."),
    );
  });

  it("a share row whose level the client does not know shows a neutral read-only badge, never 'Chỉ xem' (R3-02)", async () => {
    render(tree(access([row({ id: "s9", principal_id: "u2", level: null })])));

    const li = screen.getByText("Nguyễn An").closest("li")!;
    expect(within(li).getAllByText(t("documents.share.level_other")).length).toBeGreaterThanOrEqual(1);
    expect(within(li).queryByRole("combobox", { name: `${t("documents.share.level_label")} Nguyễn An` })).toBeNull();
    expect(within(li).queryByText(t("documents.share.level_view"))).toBeNull();
    // Revoking still works: a level the client cannot name can still be removed.
    expect(within(li).getByRole("button", { name: `${t("documents.share.revoke")} Nguyễn An` })).toBeInTheDocument();
  });

  it("a home row whose share level narrowed to null shows the neutral badge too, not a select (R3-02)", async () => {
    // The home row's level arrives through its own share row when the
    // overview's home_workspace.level itself narrowed to null.
    render(
      tree(
        access([row({ id: "s9", principal_type: "workspace", principal_id: "w1", level: null })], {
          home_workspace: { workspace_id: "w1", workspace_name: "Kinh doanh", level: null },
        }),
      ),
    );

    const li = screen.getByText("Workspace Kinh doanh").closest("li")!;
    expect(within(li).getByText(t("documents.share.level_other"))).toBeInTheDocument();
    expect(within(li).queryByRole("combobox")).toBeNull();
    expect(within(li).queryByText(t("documents.share.level_view"))).toBeNull();
  });
});
