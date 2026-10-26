import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { AdminOrganizationDetailView } from "./organization-detail";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const org = { id: "o1", slug: "acme", name: "Acme", status: "active", plan_code: "free", member_count: 3, workspace_count: 1, created_at: "2026-09-01T00:00:00Z", last_activity_at: null };

function detail(extra: Record<string, unknown> = {}) {
  return { organization: org, suspended_at: null, suspended_reason: null, entitlements: [], actions: [], deletion_scheduled_at: null, erased: false, ...extra };
}

function nav(): NavigationAdapter {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/admin/organizations/o1", searchParams: new URLSearchParams(), getShareableUrl: (p) => p };
}

function mockApi(role: string, body: unknown) {
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/admin/me") return Promise.resolve({ platform_role: role });
    if (path === "/api/v1/admin/organizations/o1" && !opts?.method) return Promise.resolve(body);
    if (path === "/api/v1/plans") return Promise.resolve({ plans: [] });
    if (path === "/api/v1/admin/flags") return Promise.resolve({ flags: [] });
    if (path.endsWith("/deletion") && opts?.method === "POST") return Promise.resolve({ deletion_scheduled_at: "2026-10-28T09:30:00Z" });
    if (path.endsWith("/deletion/cancel")) return Promise.resolve({ deletion_scheduled_at: null });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("organization deletion on the admin detail", () => {
  it("requires the slug and a long reason before it schedules", async () => {
    mockApi("admin", detail());
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tổ chức" }));
    const slug = await screen.findByLabelText("Định danh tổ chức");
    fireEvent.change(slug, { target: { value: "sai" } });
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "khách yêu cầu xóa tổ chức" } });
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
    expect(screen.getByText("Định danh chưa khớp.")).toBeInTheDocument();
    fireEvent.change(slug, { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations/o1/deletion", expect.objectContaining({
      method: "POST",
      body: { reason: "khách yêu cầu xóa tổ chức", confirm_slug: "acme" },
    })));
  });

  it("cancels a scheduled deletion with a reason and no slug", async () => {
    mockApi("admin", detail({ deletion_scheduled_at: "2026-10-28T09:30:00Z" }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByText(/Sẽ xóa cứng lúc/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác xóa" }));
    expect(screen.queryByLabelText("Định danh tổ chức")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "khách rút lại yêu cầu xóa" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations/o1/deletion/cancel", expect.objectContaining({
      method: "POST",
      body: { reason: "khách rút lại yêu cầu xóa" },
    })));
  });

  it("disables deletion after the organization is erased", async () => {
    mockApi("admin", detail({ erased: true }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    const button = await screen.findByRole("button", { name: "Xóa tổ chức" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Tổ chức đã bị xóa cứng.")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the button from support and still shows the banner", async () => {
    mockApi("support", detail({ deletion_scheduled_at: "2026-10-28T09:30:00Z" }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByText(/Sẽ xóa cứng lúc/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hoàn tác xóa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa tổ chức" })).not.toBeInTheDocument();
  });

  it("shows support the erased banner and no button", async () => {
    mockApi("support", detail({ erased: true }));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByText("Tổ chức đã bị xóa cứng.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa tổ chức" })).not.toBeInTheDocument();
  });
});
