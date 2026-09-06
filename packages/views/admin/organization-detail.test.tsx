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
const detail = {
  organization: org,
  suspended_at: null,
  suspended_reason: null,
  entitlements: [{ key: "members", kind: "quota", enabled: true, limit: 50, current: 3 }],
  actions: [{ id: "a1", actor_id: "u9", action: "organization.plan_changed", target_type: "organization", target_id: "o1", before: {}, after: {}, reason: "Pilot đối tác", trace_id: "t1", created_at: "2026-09-06T00:00:00Z" }],
};

function nav(): NavigationAdapter {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/admin/organizations/o1", searchParams: new URLSearchParams(), getShareableUrl: (p) => p };
}

function mockApi(body: unknown = detail) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === "/api/v1/admin/organizations/o1" && !opts?.method) return Promise.resolve(body);
    if (path === "/api/v1/admin/organizations/o1/suspend") return Promise.resolve({ organization: { ...org, status: "suspended" } });
    if (path === "/api/v1/plans") return Promise.resolve({ plans: [{ id: "p1", code: "team", name: "Team", features: [] }] });
    if (path === "/api/v1/admin/flags") return Promise.resolve({ flags: [] });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("AdminOrganizationDetailView", () => {
  it("renders header, overview facts, entitlements and history", async () => {
    mockApi();
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Đang hoạt động")).toBeInTheDocument();
    expect(screen.getByText("free")).toBeInTheDocument();
    expect(screen.getByText("members")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Lịch sử" }));
    expect(await screen.findByText("organization.plan_changed")).toBeInTheDocument();
    expect(screen.getByText("Pilot đối tác")).toBeInTheDocument();
  });

  it("shows not-found when the response drifted and an error when the request failed", async () => {
    mockApi({ organization: { id: 1 } });
    const { unmount } = render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByRole("status")).toHaveTextContent("Không tìm thấy tổ chức");
    unmount();
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được tổ chức");
  });

  it("suspend opens the reason dialog, refuses under 10 characters and sends the reason", async () => {
    mockApi();
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    fireEvent.click(await screen.findByRole("button", { name: "Tạm ngưng" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Tạm ngưng Acme?");
    const submit = screen.getByRole("button", { name: "Xác nhận" });
    expect(submit).toBeDisabled();
    const reason = screen.getByLabelText("Lý do");
    fireEvent.change(reason, { target: { value: "ngắn quá" } });
    expect(submit).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Khách hàng chưa thanh toán" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations/o1/suspend", {
        method: "POST",
        body: { reason: "Khách hàng chưa thanh toán" },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("change plan needs a plan picked before the reason counts", async () => {
    mockApi();
    render(wrapWithNav(<AdminOrganizationDetailView orgId="o1" />, nav()));
    fireEvent.click(await screen.findByRole("button", { name: "Đổi gói" }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "Pilot đối tác theo hợp đồng" } });
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Gói đích" })).toBeInTheDocument();
  });
});
