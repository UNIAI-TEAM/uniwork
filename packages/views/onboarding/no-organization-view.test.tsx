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
    expect(screen.getByRole("heading", { level: 1, name: "Bạn chưa thuộc tổ chức nào" })).toBeInTheDocument();
    const create = screen.getByRole("region", { name: "Tạo tổ chức" });
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
    expect(first).toHaveTextContent("Nguyễn Văn An mời bạn vào");
    const second = within(join).getByRole("link", { name: /Beta/ });
    expect(second).toHaveAttribute("href", "/invite/tok-org");
    expect(second).not.toHaveTextContent("›");
    expect(screen.queryByText(/Chưa có lời mời nào/)).not.toBeInTheDocument();
  });

  it("without an invitation, says whom to ask and for which address", async () => {
    requestMock.mockResolvedValue({ invitations: [] });
    renderView();
    expect(
      await screen.findByText("Chưa có lời mời nào. Hãy nhờ quản trị viên mời email ha@acme.vn."),
    ).toBeInTheDocument();
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
