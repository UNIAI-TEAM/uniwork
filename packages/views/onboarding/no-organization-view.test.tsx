import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { NoOrganizationView } from "./no-organization-view";

initI18n();

const user: User = {
  id: "u1",
  email: "ha@acme.vn",
  display_name: "Đỗ Thị Hà",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspaceInvite = {
  id: "i1",
  role: "member",
  org_role: "member",
  token: "tok-ws",
  expires_at: "2099-01-01T00:00:00Z",
  workspace: { id: "w1", slug: "team", name: "Team" },
  organization: { id: "o1", slug: "acme", name: "Acme" },
  invited_by: { display_name: "Nguyễn Văn An" },
};

// An invitation to the organization itself carries no workspace key at all.
const orgInvite = {
  id: "i2",
  role: "member",
  org_role: "admin",
  token: "tok-org",
  expires_at: "2099-01-01T00:00:00Z",
  organization: { id: "o2", slug: "beta", name: "Beta" },
  invited_by: { display_name: "Trần Bình" },
};

function renderView() {
  return render(wrapWithNav(<NoOrganizationView />));
}

describe("NoOrganizationView", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("offers to create an organization through the new-workspace flow", async () => {
    requestMock.mockResolvedValue({ invitations: [] });
    renderView();
    const create = await screen.findByRole("region", { name: "Tạo tổ chức" });
    expect(screen.getByRole("heading", { level: 1, name: "Bạn chưa thuộc tổ chức nào" })).toBeInTheDocument();
    expect(within(create).getByRole("link", { name: "Tạo tổ chức" })).toHaveAttribute("href", "/workspaces/new");
    await screen.findByText(/Chưa có lời mời nào/);
  });

  it("lists every pending invitation, organization-level ones included, each opening its invite page", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/me/invitations"
        ? Promise.resolve({ invitations: [workspaceInvite, orgInvite] })
        : Promise.resolve({}),
    );
    renderView();
    const join = screen.getByRole("region", { name: "Tham gia tổ chức" });
    const first = await within(join).findByRole("link", { name: /Acme › Team/ });
    expect(first).toHaveAttribute("href", "/invite/tok-ws");
    expect(first.closest("li")).toHaveTextContent("Nguyễn Văn An mời bạn vào");
    const second = within(join).getByRole("link", { name: /Beta/ });
    expect(second).toHaveAttribute("href", "/invite/tok-org");
    expect(second.closest("li")).not.toHaveTextContent("›");
    // The row names the organization role the invite page will show, not the raw enum.
    expect(second.closest("li")).toHaveTextContent("Quản trị");
    expect(screen.queryByText(/Chưa có lời mời nào/)).not.toBeInTheDocument();
  });

  it("does not offer to create an organization to someone a suspended organization still holds (ADR 0032 D1)", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/orgs"
        ? Promise.resolve({ organizations: [{ id: "o9", slug: "paused", name: "Paused", role: "member", status: "suspended" }] })
        : Promise.resolve({ invitations: [orgInvite] }),
    );
    renderView();
    expect(await screen.findByRole("heading", { level: 1, name: "Bạn đang thuộc Paused" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Tạo tổ chức" })).not.toBeInTheDocument();
    const join = screen.getByRole("region", { name: "Tham gia tổ chức" });
    expect(await within(join).findByRole("link", { name: /Beta/ })).toHaveAttribute("href", "/invite/tok-org");
  });

  /**
   * The title depends on the organization list: until it is in, the shell
   * says it is loading instead of "Bạn chưa thuộc tổ chức nào", which a
   * member of a suspended organization would see flip and steal focus.
   */
  it("does not show a title it would take back while the organization list loads", async () => {
    let answerOrgs: (v: unknown) => void = () => {};
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/orgs"
        ? new Promise((resolve) => {
            answerOrgs = resolve;
          })
        : Promise.resolve({ invitations: [orgInvite] }),
    );
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Đang tải…" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Bạn chưa thuộc tổ chức nào" })).not.toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs"));
    answerOrgs({ organizations: [{ id: "o9", slug: "paused", name: "Paused", role: "member", status: "suspended" }] });
    const title = await screen.findByRole("heading", { level: 1, name: "Bạn đang thuộc Paused" });
    // An arrival, not a change: focus stays where the person left it.
    expect(title).not.toHaveFocus();
  });

  it("holds the shell's frame, with its heading, while the host resolves the session", () => {
    requestMock.mockResolvedValue({ invitations: [] });
    render(wrapWithNav(<NoOrganizationView pending />));
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Đang tải…" })).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có lời mời nào/)).not.toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("offers to create one when the only membership was switched off", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/orgs"
        ? Promise.resolve({ organizations: [{ id: "o9", slug: "old", name: "Old", status: "active", deactivated: true }] })
        : Promise.resolve({ invitations: [] }),
    );
    renderView();
    expect(await screen.findByRole("region", { name: "Tạo tổ chức" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Bạn chưa thuộc tổ chức nào" })).toBeInTheDocument();
  });

  it("without an invitation, says whom to ask and for which address", async () => {
    requestMock.mockResolvedValue({ invitations: [] });
    renderView();
    const title = await screen.findByText("Chưa có lời mời nào");
    expect(title.closest("[role=status]")).toHaveTextContent("Nhờ quản trị viên của tổ chức mời địa chỉ ha@acme.vn.");
  });

  it("puts joining first, and creating second as an outline action, once an invitation is waiting", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/me/invitations" ? Promise.resolve({ invitations: [orgInvite] }) : Promise.resolve({}),
    );
    renderView();
    const join = screen.getByRole("region", { name: "Tham gia tổ chức" });
    await within(join).findByRole("link", { name: /Beta/ });
    const create = await screen.findByRole("region", { name: "Tạo tổ chức" });
    expect(join.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(create).getByRole("link", { name: "Tạo tổ chức" })).not.toHaveClass("bg-primary");
  });

  it("keeps creating first, as the primary action, when no invitation is waiting", async () => {
    requestMock.mockResolvedValue({ invitations: [] });
    renderView();
    const create = await screen.findByRole("region", { name: "Tạo tổ chức" });
    await screen.findByText("Chưa có lời mời nào");
    const join = screen.getByRole("region", { name: "Tham gia tổ chức" });
    expect(create.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(create).getByRole("link", { name: "Tạo tổ chức" })).toHaveClass("bg-primary");
  });

  it("says the invitations failed to load, with a retry, instead of claiming there are none", async () => {
    requestMock.mockRejectedValueOnce(new Error("boom"));
    renderView();
    expect(await screen.findByText("Không tải được danh sách lời mời.")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có lời mời nào/)).not.toBeInTheDocument();
    requestMock.mockResolvedValue({ invitations: [workspaceInvite] });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Acme › Team/ })).toBeInTheDocument());
  });
});
