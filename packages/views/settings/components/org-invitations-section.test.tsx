import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { OrgInvitationsSection } from "./org-invitations-section";

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

const ws = (id: string, name: string) => ({
  id, slug: id, name, organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
});

type Init = { method?: string; body?: unknown } | undefined;

function serve({ workspaces = [ws("w1", "Kinh doanh"), ws("w2", "Vận hành")], invitations = [] as unknown[] } = {}) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path === "/api/v1/orgs/o1/workspaces") return Promise.resolve({ workspaces });
    if (path.endsWith("/invitations") && init?.method === "POST") return Promise.resolve({ invitations: [], skipped: [] });
    if (path.endsWith("/invitations")) return Promise.resolve({ invitations });
    return Promise.resolve({});
  });
}

const posted = () =>
  requestMock.mock.calls
    .filter(([, init]) => (init as Init)?.method === "POST")
    .map(([, init]) => (init as Init)?.body);

function renderSection() {
  return render(wrap(<OrgInvitationsSection orgSlug="acme" orgId="o1" />));
}

describe("OrgInvitationsSection", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  /**
   * UNI-1582: the admin picks the workspaces the invitee joins on accept.
   * None is a valid choice; organization membership opens none by itself.
   */
  it("lets the admin pick the workspaces the invitee joins, and sends them with the invitation", async () => {
    serve();
    renderSection();
    const picker = await screen.findByRole("group", { name: "Vào workspace" });
    const sales = await within(picker).findByRole("checkbox", { name: "Kinh doanh" });
    expect(within(picker).getByRole("checkbox", { name: "Vận hành" })).not.toBeChecked();
    fireEvent.click(sales);
    expect(sales).toBeChecked();
    const field = screen.getByLabelText("Email đồng nghiệp");
    fireEvent.change(field, { target: { value: "moi@acme.vn" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() =>
      expect(posted()).toEqual([{ emails: ["moi@acme.vn"], org_role: "member", workspace_ids: ["w1"] }]),
    );
  });

  it("sends no workspace when none is picked", async () => {
    serve();
    renderSection();
    await screen.findByRole("checkbox", { name: "Kinh doanh" });
    const field = screen.getByLabelText("Email đồng nghiệp");
    fireEvent.change(field, { target: { value: "moi@acme.vn" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => expect(posted()).toEqual([{ emails: ["moi@acme.vn"], org_role: "member", workspace_ids: [] }]));
  });

  it("says when the organization has no workspace to grant yet", async () => {
    serve({ workspaces: [] });
    renderSection();
    const picker = await screen.findByRole("group", { name: "Vào workspace" });
    expect(await within(picker).findByText("Tổ chức chưa có workspace nào.")).toBeInTheDocument();
    expect(within(picker).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("names the workspaces each pending invitation grants, and says when it grants none", async () => {
    serve({
      invitations: [
        {
          id: "i1", email: "moi@acme.vn", org_role: "member", created_at: "", expires_at: "2099-01-01T00:00:00Z",
          workspaces: [{ id: "w1", slug: "w1", name: "Kinh doanh" }, { id: "w2", slug: "w2", name: "Vận hành" }],
        },
        { id: "i2", email: "khac@acme.vn", org_role: "member", created_at: "", expires_at: "2099-01-01T00:00:00Z" },
      ],
    });
    renderSection();
    const granted = (await screen.findByText("moi@acme.vn")).closest("li")!;
    expect(granted).toHaveTextContent("Vào Kinh doanh, Vận hành");
    const none = screen.getByText("khac@acme.vn").closest("li")!;
    expect(none).toHaveTextContent("Chưa cấp workspace");
  });
});
