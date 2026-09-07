import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    requestMock.mockResolvedValue({ organizations: [], total: 0 });
    render(wrapWithNav(<AdminOrganizationsView />, nav()));
    expect(await screen.findByRole("status")).toHaveTextContent("Chưa có tổ chức nào khớp");
  });

  it("shows the error state with retry", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrapWithNav(<AdminOrganizationsView />, nav()));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được danh sách tổ chức");
    requestMock.mockResolvedValue({ organizations: orgs, total: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
  });

  it("lists rows and opens the detail through a real link", async () => {
    requestMock.mockResolvedValue({ organizations: orgs, total: 2, limit: 50, offset: 0 });
    const adapter = nav();
    render(wrapWithNav(<AdminOrganizationsView />, adapter));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Tạm ngưng")).toBeInTheDocument();
    expect(screen.getByText("team")).toBeInTheDocument();
    expect(screen.getByText("Chưa có")).toBeInTheDocument();
    // The name is a link, so cmd-click and "copy link" keep working.
    const link = screen.getByRole("link", { name: "Acme" });
    expect(link).toHaveAttribute("href", "/admin/organizations/o1");
    fireEvent.click(link);
    expect(adapter.push).toHaveBeenCalledWith("/admin/organizations/o1");
  });

  it("asks the server to sort instead of reordering the page it holds", async () => {
    requestMock.mockResolvedValue({ organizations: orgs, total: 2, limit: 50, offset: 0 });
    render(wrapWithNav(<AdminOrganizationsView />, nav()));
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: "Hoạt động gần nhất" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations?sort=activity_desc&limit=50"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hoạt động gần nhất" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations?sort=activity_asc&limit=50"),
    );
  });

  it("debounces the search box into one request", async () => {
    vi.useFakeTimers();
    try {
      requestMock.mockResolvedValue({ organizations: orgs, total: 2, limit: 50, offset: 0 });
      render(wrapWithNav(<AdminOrganizationsView />, nav()));
      const box = screen.getByRole("searchbox", { name: "Tìm tổ chức" });
      fireEvent.change(box, { target: { value: "a" } });
      fireEvent.change(box, { target: { value: "ac" } });
      fireEvent.change(box, { target: { value: "acm" } });
      expect(requestMock.mock.calls.filter((c) => String(c[0]).includes("q=")).length).toBe(0);
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const searches = requestMock.mock.calls.map(String).filter((c) => c.includes("q="));
      expect(searches).toEqual(["/api/v1/admin/organizations?q=acm&limit=50"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pages with the total the server reported", async () => {
    requestMock.mockResolvedValue({ organizations: orgs, total: 128, limit: 50, offset: 0 });
    render(wrapWithNav(<AdminOrganizationsView />, nav()));
    expect(await screen.findByText("1–2 trên 128 tổ chức")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trang trước/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Trang sau/ }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations?limit=50&offset=50"),
    );
  });
});
