import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

  it("drops the reporting panel when the person has neither side of it", async () => {
    mockApi({ ...an, manager: null });
    renderView();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Quan hệ báo cáo")).toBeNull();
  });
});
