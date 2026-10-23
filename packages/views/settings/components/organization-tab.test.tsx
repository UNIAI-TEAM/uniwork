import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap, wrapWithNav } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import type { NavigationAdapter } from "../../navigation";
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

/** The tab inside a navigation adapter whose replace() is a spy. */
function renderTabWithNav() {
  const replace = vi.fn<(path: string) => void>();
  const adapter: NavigationAdapter = {
    push: vi.fn(),
    replace,
    back: vi.fn(),
    pathname: "/acme/team/settings",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <OrganizationTab />
      </WorkspaceProvider>,
      adapter,
    ),
  );
  return { replace };
}

/** The owner is the only active member: nobody to hand the organization to. */
function mockSoleOwner(close: (body: unknown) => Promise<unknown> = () => Promise.resolve({ status: "ok" })) {
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path.endsWith("/members/me")) return Promise.resolve({ role: "owner" });
    if (path.includes("/members?")) return Promise.resolve({ members: [members[0]] });
    if (path.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
    if (path.endsWith("/close")) return close(init?.body);
    return Promise.resolve({});
  });
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
      screen.getByText("Bạn là chủ sở hữu. Chuyển quyền sở hữu cho người khác trước khi rời."),
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

  it("sends a member who left to /get-started", async () => {
    mockApi("member");
    const { replace } = renderTabWithNav();
    const leave = await screen.findByRole("button", { name: "Rời tổ chức" });
    await waitFor(() => expect(leave).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(leave);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Rời tổ chức" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"));
  });

  it("offers closing only to an owner who is the last active member", async () => {
    mockApi("member");
    const { unmount } = renderTab();
    await screen.findByRole("button", { name: "Rời tổ chức" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Rời tổ chức" })).not.toHaveAttribute("aria-disabled"));
    expect(screen.queryByRole("button", { name: "Đóng tổ chức" })).not.toBeInTheDocument();
    unmount();

    // An owner with other active members transfers instead.
    mockApi("owner");
    const second = renderTab();
    expect(await screen.findByRole("button", { name: "Chuyển quyền" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: "Đóng tổ chức" })).not.toBeInTheDocument();
    second.unmount();

    mockSoleOwner();
    renderTab();
    expect(await screen.findByRole("button", { name: "Đóng tổ chức" })).not.toHaveAttribute("aria-disabled");
    // Leave stays inert and says where the way out is.
    const leave = screen.getByRole("button", { name: "Rời tổ chức" });
    expect(leave).toHaveAttribute("aria-disabled", "true");
    // The consequence, then why it is refused.
    expect(leave).toHaveAccessibleDescription(
      "Bạn mất quyền vào mọi workspace trong tổ chức này ngay lập tức. Bạn là chủ sở hữu và là thành viên duy nhất. Đóng tổ chức thay vì rời.",
    );
  });

  it("closes only once the slug is typed back exactly, then sends the owner to /get-started", async () => {
    const close = vi.fn((_body: unknown) => Promise.resolve({ status: "ok" }));
    mockSoleOwner(close);
    const { replace } = renderTabWithNav();
    fireEvent.click(await screen.findByRole("button", { name: "Đóng tổ chức" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Đóng Acme?");
    const submit = within(dialog).getByRole("button", { name: "Đóng tổ chức" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    // What is missing is said in words, beside the held-back button and on it.
    expect(submit).toHaveAccessibleDescription("Gõ đúng định danh tổ chức để đóng.");
    // The page behind dims harder: closing cannot be undone from here.
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass("bg-black/45");

    const field = within(dialog).getByLabelText("Gõ định danh tổ chức để xác nhận");
    fireEvent.change(field, { target: { value: "Acme" } });
    fireEvent.blur(field);
    expect(field).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(submit);
    expect(close).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "acme" } });
    expect(submit).not.toHaveAttribute("aria-disabled");
    fireEvent.click(submit);
    await waitFor(() => expect(close).toHaveBeenCalledWith({ confirm_slug: "acme" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/get-started"));
  });

  it("keeps the owner on the page and says why when somebody joined in the meantime", async () => {
    mockSoleOwner(() => Promise.reject(new ApiError("còn thành viên", "organization_has_members", 409)));
    const { replace } = renderTabWithNav();
    fireEvent.click(await screen.findByRole("button", { name: "Đóng tổ chức" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Gõ định danh tổ chức để xác nhận"), {
      target: { value: "acme" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng tổ chức" }));
    expect(
      await within(dialog).findByText("Tổ chức vẫn còn thành viên khác. Chuyển quyền sở hữu trước khi đóng."),
    ).toBeInTheDocument();
    expect(screen.queryByText("còn thành viên")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    // Pressing again cannot help; the transfer is offered in place.
    const held = within(dialog).getByRole("button", { name: "Đóng tổ chức" });
    expect(held).toHaveAttribute("aria-disabled", "true");
    // The refusal on screen is the reason, said once.
    expect(held).toHaveAccessibleDescription("Tổ chức vẫn còn thành viên khác. Chuyển quyền sở hữu trước khi đóng.");
    expect(within(dialog).getAllByText("Tổ chức vẫn còn thành viên khác. Chuyển quyền sở hữu trước khi đóng.")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Chuyển quyền" }));
    expect(await screen.findByRole("dialog", { name: "Chuyển quyền sở hữu Acme?" })).toBeInTheDocument();
  });

  it("lands focus on the danger zone heading once ownership has moved, not on <body>", async () => {
    let role = "owner";
    requestMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.endsWith("/members/me")) return Promise.resolve({ role });
      if (path.includes("/members?")) return Promise.resolve({ members });
      if (path.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (path.endsWith("/transfer-ownership") && init?.method === "POST") {
        role = "admin";
        return Promise.resolve({ member: { user_id: "u2", role: "owner" } });
      }
      return Promise.resolve({});
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Chuyển quyền" }));
    const dialog = await screen.findByRole("dialog", { name: "Chuyển quyền sở hữu Acme?" });
    const combobox = within(dialog).getByRole("combobox", { name: "Chủ sở hữu mới" });
    fireEvent.click(combobox);
    const option = await screen.findByRole("option", { name: "Nguyễn Văn An an@acme.vn" });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    await waitFor(() => expect(combobox).toHaveTextContent("Nguyễn Văn An"));
    fireEvent.change(within(dialog).getByLabelText("Gõ tên tổ chức để xác nhận"), { target: { value: "Acme" } });
    fireEvent.change(within(dialog).getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Chuyển quyền" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 3000 });
    // The owner's rows are gone with the role; focus waits on the heading of
    // the zone that changed, and the Leave row now lets the admin go.
    const heading = screen.getByRole("heading", { name: "Vùng nguy hiểm" });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Chuyển quyền" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Rời tổ chức" })).not.toHaveAttribute("aria-disabled");
  });

  it("holds the danger zone's place while the role is unknown, instead of showing a member's rows to the owner", async () => {
    let answer: (v: unknown) => void = () => {};
    requestMock.mockImplementation((path: string) => {
      if (path.endsWith("/members/me")) return new Promise((resolve) => (answer = resolve));
      if (path.includes("/members?")) return Promise.resolve({ members });
      if (path.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });
    renderTab();
    await screen.findByText("Nguyễn Văn An");
    expect(screen.getByRole("heading", { name: "Vùng nguy hiểm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rời tổ chức" })).not.toBeInTheDocument();
    expect(screen.queryByText("Rời tổ chức sẽ đưa bạn ra khỏi mọi workspace trong đó.")).not.toBeInTheDocument();
    answer({ role: "owner" });
    expect(await screen.findByRole("button", { name: "Chuyển quyền" })).toBeInTheDocument();
  });

  it("decides the close row from the first page that already shows another active member", async () => {
    let second: (v: unknown) => void = () => {};
    requestMock.mockImplementation((path: string) => {
      if (path.endsWith("/members/me")) return Promise.resolve({ role: "owner" });
      if (path.includes("status=active") && path.includes("cursor=p2")) {
        return new Promise((resolve) => (second = resolve));
      }
      if (path.includes("status=active")) return Promise.resolve({ members: [members[0], members[1]], next_cursor: "p2" });
      if (path.includes("/members?")) return Promise.resolve({ members });
      if (path.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      return Promise.resolve({});
    });
    renderTab();
    const leave = await screen.findByRole("button", { name: "Rời tổ chức" });
    // Page one already names a candidate: no close row, and the final reason.
    expect(screen.queryByRole("button", { name: "Đóng tổ chức" })).not.toBeInTheDocument();
    expect(leave).toHaveAccessibleDescription(/Chuyển quyền sở hữu cho người khác trước khi rời/);
    second({ members: [] });
  });
});
