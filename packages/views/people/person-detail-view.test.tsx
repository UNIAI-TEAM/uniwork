import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { PersonDetailView } from "./person-detail-view";

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
  slug: "doi",
  name: "Đội",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const an = {
  user_id: "u2",
  display_name: "Nguyễn Văn Ân",
  email: "an@acme.vn",
  org_role: "member",
  status: "active",
  title: "Trưởng nhóm",
  department: { id: "d1", name: "Kỹ thuật" },
  manager: { id: "u1", kind: "human", display_name: "Đỗ Thị Hà" },
  employee_code: "UNI-0142",
  phone: "0912 345 678",
  location: "Hà Nội",
  joined_on: "2024-03-18",
  timezone: "Asia/Ho_Chi_Minh",
};

/** The detail endpoint failing with `err`, for the two ways a profile can fail to show. */
function mockFailure(err: Error) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role: "owner" });
    if (path.startsWith("/api/v1/orgs/acme/people/")) return Promise.reject(err);
    return Promise.resolve({});
  });
}

/** The detail endpoint plus the membership call every people screen makes. */
function mockApi(person: Record<string, unknown>, reports: unknown[] = []) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role: "owner" });
    if (path.startsWith("/api/v1/orgs/acme/people/")) return Promise.resolve({ person, reports });
    return Promise.resolve({});
  });
}

function renderView() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <PersonDetailView userId="u2" />
      </WorkspaceProvider>,
    ),
  );
}

describe("PersonDetailView", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("makes the person's name the page's only h1", async () => {
    mockApi(an);
    renderView();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Nguyễn Văn Ân");
  });

  it("offers the address and the number as actions, not as text to copy out", async () => {
    mockApi(an);
    renderView();
    const email = await screen.findByRole("link", { name: "Gửi email cho Nguyễn Văn Ân" });
    expect(email).toHaveAttribute("href", "mailto:an@acme.vn");
    // The spaces a person types into the field are not part of the number.
    expect(screen.getByRole("link", { name: "Gọi cho Nguyễn Văn Ân" })).toHaveAttribute(
      "href",
      "tel:0912345678",
    );
  });

  it("navigates to a colleague with a link, so a middle click opens a tab", async () => {
    mockApi(an, [{ id: "u3", kind: "human", display_name: "Lê Minh" }]);
    renderView();
    expect(await screen.findByRole("link", { name: /Đỗ Thị Hà/ })).toHaveAttribute(
      "href",
      "/acme/doi/people/u1",
    );
    expect(screen.getByRole("link", { name: /Lê Minh/ })).toHaveAttribute(
      "href",
      "/acme/doi/people/u3",
    );
  });

  it("reads the stored date and timezone out rather than printing them", async () => {
    mockApi(an);
    renderView();
    expect(await screen.findByText("18 tháng 3, 2024")).toBeInTheDocument();
    expect(screen.getByText("GMT+7 · Giờ Đông Dương")).toBeInTheDocument();
    expect(screen.queryByText("2024-03-18")).toBeNull();
    expect(screen.queryByText("Asia/Ho_Chi_Minh")).toBeNull();
  });

  it("says the facts are missing instead of leaving a blank panel", async () => {
    mockApi({ ...an, employee_code: "", phone: "", location: "", joined_on: "", timezone: "" });
    renderView();
    expect(await screen.findByText("Chưa có thông tin nào.")).toBeInTheDocument();
  });

  it("keeps the reporting panel and says plainly when there is nobody on either side", async () => {
    mockApi({ ...an, manager: null });
    renderView();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Chưa có quản lý trực tiếp")).toBeInTheDocument();
    expect(screen.getByText("Chưa có ai")).toBeInTheDocument();
  });

  it("puts the ways to reach the person under their name, chat first", async () => {
    mockApi(an);
    renderView();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: "Nhắn tin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sao chép email" })).toBeInTheDocument();
  });

  it("shows the time where the person is, not only their zone", async () => {
    mockApi(an);
    renderView();
    expect(await screen.findByText(/^Bây giờ ở đó là \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("says a person is not here only when the server says so", async () => {
    mockFailure(new ApiError("not found", "not_found", 404));
    renderView();
    expect(await screen.findByRole("heading", { name: "Không tìm thấy người này" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
  });

  it("offers a failed load again instead of calling the person gone", async () => {
    mockFailure(new ApiError("boom", "internal", 500));
    renderView();
    expect(await screen.findByRole("heading", { name: "Không tải được hồ sơ" })).toBeInTheDocument();
    expect(screen.queryByText("Không tìm thấy người này")).toBeNull();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("asks before reactivating a deactivated account", async () => {
    mockApi({ ...an, status: "deactivated" });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Kích hoạt lại" }));
    expect(await screen.findByRole("alertdialog", { name: "Kích hoạt lại Nguyễn Văn Ân?" })).toBeInTheDocument();
    expect(requestMock.mock.calls.some(([path]) => String(path).includes("reactivate"))).toBe(false);
  });
});
