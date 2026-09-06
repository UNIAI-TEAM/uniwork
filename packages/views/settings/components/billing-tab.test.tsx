import { fireEvent, render, screen } from "@testing-library/react";
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
  { id: "p2", code: "team", name: "Team", price_amount: 500000, billing_period: "month", features: [{ feature_key: "members.max", enabled: true, quota_limit: 50 }] },
  { id: "p3", code: "team_free", name: "Team Free", price_amount: 0, features: [] },
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

  it("shows the owner the plan, price, usage with what is left, and plan cards", async () => {
    mockApi("owner");
    renderTab();
    expect(await screen.findAllByText("Starter")).not.toHaveLength(0);
    expect(screen.getByText("Đang hiệu lực")).toBeInTheDocument();
    expect(screen.getByText("12 / 50 thành viên")).toBeInTheDocument();
    expect(screen.getByText("Còn 38")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Thành viên tổ chức" })).toHaveAttribute("aria-valuenow", "24");
    expect(screen.getByText("Tắt")).toBeInTheDocument();
    // Plan cards: the current one is marked, the paid one goes to checkout.
    await screen.findByTestId("plan-card-team");
    expect(screen.getAllByText("Gói hiện tại").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Thanh toán" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ngừng gói cuối kỳ" })).toBeInTheDocument();
  });

  it("asks before switching to a free plan", async () => {
    mockApi("owner");
    renderTab();
    await screen.findByTestId("plan-card-team_free");
    fireEvent.click(screen.getByRole("button", { name: "Chọn gói này" }));
    expect(await screen.findByText("Đổi sang gói Team Free?")).toBeInTheDocument();
  });

  it("marks a past_due subscription and lets an admin look without the plan picker", async () => {
    mockApi("admin", { ...subscription, status: "past_due", current_period_end: "2026-10-06T00:00:00Z" });
    renderTab();
    expect(await screen.findByText("Quá hạn thanh toán")).toBeInTheDocument();
    expect(screen.getByText("Chỉ chủ sở hữu tổ chức đổi được gói.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chọn gói này" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ngừng gói cuối kỳ" })).toBeNull();
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
