/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emitEntitlementGateError, resetEntitlementGateErrorBusForTests } from "@uniwork/core/api";
import { emitQuotaThreshold, resetQuotaThresholdBusForTests } from "@uniwork/core/billing/quota-threshold-bus";
import { EntitlementGateToastHost } from "./entitlement-gate-toast";

const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { warning: (...a: unknown[]) => toastWarning(...a), error: (...a: unknown[]) => toastError(...a) } }));

const push = vi.fn();
vi.mock("../navigation", () => ({
  useNavigation: () => ({ push, pathname: "/acme/team/settings", searchParams: new URLSearchParams() }),
}));

vi.mock("./workspace-context", () => ({
  useWorkspace: () => ({
    workspace: {
      id: "ws1",
      slug: "team",
      organization_id: "org1",
      organization_slug: "acme",
      name: "Team",
    },
  }),
}));

vi.mock("@uniwork/core/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "admin1" } }),
}));

vi.mock("@uniwork/core/permissions", () => ({
  useBillingPermissions: () => ({
    canView: { allowed: true, reason: null },
    canManage: { allowed: false, reason: null },
    isLoading: false,
  }),
}));

describe("EntitlementGateToastHost", () => {
  it("shows a warning toast when a quota threshold targets the user", () => {
    resetQuotaThresholdBusForTests();
    resetEntitlementGateErrorBusForTests();
    toastWarning.mockClear();
    render(<EntitlementGateToastHost />);
    emitQuotaThreshold({ organizationId: "org1", userId: "admin1" });
    expect(toastWarning).toHaveBeenCalled();
  });

  it("shows an error toast when the API emits an entitlement gate", () => {
    resetEntitlementGateErrorBusForTests();
    toastError.mockClear();
    render(<EntitlementGateToastHost />);
    emitEntitlementGateError({ code: "quota_exceeded" });
    expect(toastError).toHaveBeenCalled();
  });

  it("names the missing feature with its translated label", () => {
    resetEntitlementGateErrorBusForTests();
    toastError.mockClear();
    render(<EntitlementGateToastHost />);
    emitEntitlementGateError({ code: "entitlement_required", fields: { feature: "meeting.recording" } });
    const msg = String(toastError.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("Ghi hình cuộc họp");
    expect(msg).not.toContain("meeting.recording");
  });

  it("falls back to the raw feature key when no label exists", () => {
    resetEntitlementGateErrorBusForTests();
    toastError.mockClear();
    render(<EntitlementGateToastHost />);
    emitEntitlementGateError({ code: "entitlement_required", fields: { feature: "foo.bar" } });
    const msg = String(toastError.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("foo.bar");
  });
});
