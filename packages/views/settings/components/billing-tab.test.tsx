import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { BillingTab } from "./billing-tab";

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
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

const subscription = {
  id: "s1", plan_code: "starter", plan_name: "Starter", status: "active", provider: "manual",
  current_period_start: "2026-09-06T00:00:00Z", row_version: 1,
};
const entitlements = [
  { feature_key: "members.max", name: "Thành viên tổ chức", kind: "quota", unit: "members", enabled: true, quota_limit: 50, current_usage: 12 },
  { feature_key: "meeting.recording", name: "Ghi hình cuộc họp", kind: "flag", enabled: false, quota_limit: null, current_usage: 0 },
];
const plans = [
  { id: "p1", code: "starter", name: "Starter", price_amount: 0, features: [] },
  { id: "p2", code: "team", name: "Team", price_amount: 500000, features: [] },
];

/** `role` is what the organizations list reports — the only thing the gate reads. */
function mockApi(role: string, sub: Record<string, unknown> = subscription) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs") {
      return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role }] });
    }
    if (path === "/api/v1/plans") return Promise.resolve({ plans });
    if (path.endsWith("/billing")) return Promise.resolve({ subscription: sub, entitlements });
    return Promise.resolve({});
  });
}

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <BillingTab />
      </WorkspaceProvider>,
    ),
  );
}

describe("BillingTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("shows the owner the plan, its status, usage against limits and the plan picker", async () => {
    mockApi("owner");
    renderTab();
    expect(await screen.findByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Đang hiệu lực")).toBeInTheDocument();
    expect(screen.getByText("12 / 50")).toBeInTheDocument();
    expect(screen.getByText("Tắt")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Đổi gói")).not.toBeDisabled());
    expect(screen.getByRole("option", { name: "Team (trả phí)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Starter/ })).toBeNull();
  });

  it("marks a past_due subscription and lets an admin look without the picker", async () => {
    mockApi("admin", { ...subscription, status: "past_due", current_period_end: "2026-10-06T00:00:00Z" });
    renderTab();
    expect(await screen.findByText("Quá hạn thanh toán")).toBeInTheDocument();
    expect(screen.getByText("Chỉ chủ sở hữu tổ chức đổi được gói.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Đổi gói")).toBeNull();
  });

  it("tells a plain member why billing is not theirs", async () => {
    mockApi("member");
    renderTab();
    expect(await screen.findByText("Bạn không xem được mục thanh toán")).toBeInTheDocument();
    expect(screen.queryByText("Starter")).toBeNull();
  });

  it("says the plan could not be loaded rather than blanking the screen", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs") {
        return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role: "owner" }] });
      }
      return Promise.reject(new Error("boom"));
    });
    renderTab();
    expect(await screen.findByText("Không tải được thông tin gói")).toBeInTheDocument();
  });
});
