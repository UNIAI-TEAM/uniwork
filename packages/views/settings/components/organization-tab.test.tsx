import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { OrganizationTab } from "./organization-tab";

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

const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const members = [
  { user_id: "u1", email: "ha@acme.vn", display_name: "Đỗ Thị Hà", role: "owner", created_at: "" },
  { user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn An", role: "member", created_at: "" },
  {
    user_id: "u3",
    email: "binh@acme.vn",
    display_name: "Trần Bình",
    role: "member",
    created_at: "",
    deactivated_at: "2026-09-10T00:00:00Z",
  },
];

const invitations = [
  {
    id: "i1",
    email: "moi@acme.vn",
    org_role: "admin",
    invited_by_name: "Đỗ Thị Hà",
    created_at: "2026-09-20T00:00:00Z",
    expires_at: "2099-09-27T00:00:00Z",
  },
];

type Init = { method?: string } | undefined;

function mockApi(role: string) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path.endsWith("/members/me")) return Promise.resolve({ role });
    if (path.includes("/members?")) return Promise.resolve({ members });
    if (path.endsWith("/invitations") && !init?.method) return Promise.resolve({ invitations });
    if (init?.method === "POST" || init?.method === "DELETE") return Promise.resolve({ status: "ok" });
    return Promise.resolve({});
  });
}

const calls = (method: string) =>
  requestMock.mock.calls.filter(([, init]) => (init as Init)?.method === method).map(([path]) => String(path));

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <OrganizationTab />
      </WorkspaceProvider>,
    ),
  );
}

describe("OrganizationTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("tells the owner why they cannot leave, in Vietnamese, and keeps the action inert", async () => {
    mockApi("owner");
    renderTab();
    const leave = await screen.findByRole("button", { name: "Rời tổ chức" });
    await waitFor(() => expect(leave).toHaveAttribute("aria-disabled", "true"));
    expect(
      screen.getByText("Bạn là chủ sở hữu. Chuyển quyền chủ sở hữu cho người khác trước khi rời."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Transfer ownership before leaving/)).not.toBeInTheDocument();
    fireEvent.click(leave);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks a member to confirm before leaving the organization", async () => {
    mockApi("member");
    renderTab();
    const leave = await screen.findByRole("button", { name: "Rời tổ chức" });
    await waitFor(() => expect(leave).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(leave);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Rời Acme?");
    expect(calls("POST")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Rời tổ chức" }));
    await waitFor(() => expect(calls("POST")).toEqual(["/api/v1/orgs/acme/leave"]));
  });

  it("deactivates only after a confirmation, and reactivates directly", async () => {
    mockApi("owner");
    renderTab();
    const row = (await screen.findByText("Nguyễn Văn An")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Vô hiệu hóa" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Vô hiệu hóa Nguyễn Văn An?");
    expect(calls("POST")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Vô hiệu hóa" }));
    await waitFor(() => expect(calls("POST")).toEqual(["/api/v1/orgs/acme/members/u2/deactivate"]));

    const off = screen.getByText("Trần Bình").closest("li")!;
    expect(within(off).getByText("Đã vô hiệu hóa")).toBeInTheDocument();
    fireEvent.click(within(off).getByRole("button", { name: "Kích hoạt lại" }));
    await waitFor(() => expect(calls("POST")).toContain("/api/v1/orgs/acme/members/u3/reactivate"));
  });

  it("counts and searches the members, and translates roles", async () => {
    mockApi("owner");
    renderTab();
    expect(await screen.findByRole("heading", { name: "3 thành viên" })).toBeInTheDocument();
    expect(screen.getByText("Chủ sở hữu")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm thành viên" }), {
      target: { value: "nguyen van an" },
    });
    expect(screen.getByText("Nguyễn Văn An")).toBeInTheDocument();
    expect(screen.queryByText("Trần Bình")).not.toBeInTheDocument();
  });

  it("lists pending invitations with their dates and revokes one only after a confirmation", async () => {
    mockApi("owner");
    renderTab();
    const row = (await screen.findByText("moi@acme.vn")).closest("li")!;
    expect(row).toHaveTextContent("Quản trị");
    expect(row).toHaveTextContent(/Gửi .*2026/);
    expect(row).toHaveTextContent("Đỗ Thị Hà mời");
    fireEvent.click(within(row).getByRole("button", { name: "Thu hồi" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Thu hồi lời mời gửi moi@acme.vn?");
    expect(calls("DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Thu hồi" }));
    await waitFor(() => expect(calls("DELETE")).toEqual(["/api/v1/orgs/acme/invitations/i1"]));
  });

  it("says the member list failed to load, with a retry, instead of an empty search result", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.endsWith("/members/me")) return Promise.resolve({ role: "owner" });
      if (path.includes("/members?")) return Promise.reject(new Error("boom"));
      if (path.endsWith("/invitations")) return Promise.reject(new Error("boom"));
      return Promise.resolve({});
    });
    renderTab();
    expect(await screen.findByText("Không tải được danh sách thành viên.")).toBeInTheDocument();
    expect(await screen.findByText("Không tải được danh sách lời mời.")).toBeInTheDocument();
    expect(screen.queryByText(/Không có thành viên nào khớp/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Thử lại" }).length).toBeGreaterThan(0);
  });

  it("shows why the owner's own row cannot change, and keeps deactivate visible but inert", async () => {
    mockApi("owner");
    renderTab();
    const row = (await screen.findByText("Đỗ Thị Hà", { selector: "li *" })).closest("li")!;
    const deactivate = within(row).getByRole("button", { name: "Vô hiệu hóa" });
    await waitFor(() => expect(deactivate).toHaveAttribute("aria-disabled", "true"));
    expect(deactivate).toHaveAccessibleDescription("Bạn không thực hiện được thao tác này với chính mình.");
  });

  it("reads further member pages before claiming there is nobody to transfer ownership to", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.endsWith("/members/me")) return Promise.resolve({ role: "owner" });
      if (path.includes("status=active") && path.includes("cursor=p2")) {
        return Promise.resolve({ members: [members[1]] });
      }
      if (path.includes("status=active")) return Promise.resolve({ members: [members[0]], next_cursor: "p2" });
      if (path.includes("/members?")) return Promise.resolve({ members });
      if (path.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });
    renderTab();
    await waitFor(() =>
      expect(requestMock.mock.calls.map(([p]) => String(p))).toContain("/api/v1/orgs/acme/members?status=active&cursor=p2"),
    );
    const transfer = await screen.findByRole("button", { name: "Chuyển quyền" });
    expect(transfer).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText("Chưa có thành viên nào đang hoạt động để nhận quyền.")).not.toBeInTheDocument();
  });

  it("keeps skipped addresses in the field and does not celebrate when nothing was sent", async () => {
    requestMock.mockImplementation((path: string, init?: Init) => {
      if (path.endsWith("/members/me")) return Promise.resolve({ role: "owner" });
      if (path.includes("/members?")) return Promise.resolve({ members });
      if (path.endsWith("/invitations") && init?.method === "POST") {
        return Promise.resolve({ invitations: [], skipped: ["an@acme.vn"] });
      }
      if (path.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });
    renderTab();
    const field = await screen.findByLabelText("Email đồng nghiệp");
    fireEvent.change(field, { target: { value: "an@acme.vn" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lời mời" }));
    await waitFor(() => expect(calls("POST")).toEqual(["/api/v1/orgs/acme/invitations"]));
    const notice = await screen.findByText(/Bỏ qua \(đã là thành viên hoặc không hợp lệ\): an@acme\.vn/);
    expect(notice).toHaveAttribute("role", "status");
    // The chip is still there to fix or remove.
    expect(document.querySelector('[data-slot="email-chips"]')).toHaveTextContent("an@acme.vn");
  });
});
