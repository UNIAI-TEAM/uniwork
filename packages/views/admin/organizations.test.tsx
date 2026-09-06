import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { AdminOrganizationsView } from "./organizations";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const orgs = [
  { id: "o1", slug: "acme", name: "Acme", status: "active", plan_code: "free", member_count: 3, workspace_count: 1, created_at: "2026-09-01T00:00:00Z", last_activity_at: "2026-09-05T00:00:00Z" },
  { id: "o2", slug: "beta", name: "Beta", status: "suspended", plan_code: "team", member_count: 9, workspace_count: 2, created_at: "2026-09-02T00:00:00Z", last_activity_at: null },
];

function nav(): NavigationAdapter {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/admin", searchParams: new URLSearchParams(), getShareableUrl: (p) => p };
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("AdminOrganizationsView", () => {
  it("shows the empty state when nothing matches", async () => {
    requestMock.mockResolvedValue({ organizations: [] });
    render(wrapWithNav(<AdminOrganizationsView />, nav()));
    expect(await screen.findByRole("status")).toHaveTextContent("Chưa có tổ chức nào khớp");
  });

  it("shows the error state with retry", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrapWithNav(<AdminOrganizationsView />, nav()));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được danh sách tổ chức");
    requestMock.mockResolvedValue({ organizations: orgs });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
  });

  it("lists rows with status, plan and last activity, sorts, filters and opens the detail", async () => {
    requestMock.mockResolvedValue({ organizations: orgs });
    const adapter = nav();
    render(wrapWithNav(<AdminOrganizationsView />, adapter));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Tạm ngưng")).toBeInTheDocument();
    expect(screen.getByText("team")).toBeInTheDocument();
    expect(screen.getByText("Chưa có")).toBeInTheDocument();
    // Newest activity first; the toggle flips it.
    const before = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(before[0]).toContain("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Hoạt động gần nhất" }));
    const after = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(after[0]).toContain("Beta");
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm tổ chức" }), { target: { value: "ac" } });
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations?q=ac"));
    fireEvent.click(screen.getByText("Acme"));
    expect(adapter.push).toHaveBeenCalledWith("/admin/organizations/o1");
  });
});
