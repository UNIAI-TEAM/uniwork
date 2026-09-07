import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { AdminQuotaView } from "./quota";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const org = {
  id: "o1", slug: "acme", name: "Acme", status: "active", plan_code: "free",
  member_count: 40, workspace_count: 1, created_at: "2026-09-01T00:00:00Z", last_activity_at: null,
};

/** The screen is gated by admin_quota; the flag has to be on to see anything. */
function withFlag(ui: React.ReactElement, on: boolean) {
  const service = new FeatureFlagService(new StaticProvider({ admin_quota: { default: on } }));
  return wrap(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>);
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("AdminQuotaView", () => {
  it("stays behind its flag", async () => {
    render(withFlag(<AdminQuotaView />, false));
    expect(await screen.findByRole("status")).toHaveTextContent("Màn hình hạn mức đang tắt");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("offers the organizations to pick from once the flag is on", async () => {
    requestMock.mockResolvedValue({ organizations: [org], total: 1, limit: 200, offset: 0 });
    render(withFlag(<AdminQuotaView />, true));
    // The picker asks the server for the most recently active tenants only.
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/organizations?sort=activity_desc&limit=200"),
    );
    expect(screen.getByRole("combobox", { name: "Chọn tổ chức" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Chọn một tổ chức");
  });
});
