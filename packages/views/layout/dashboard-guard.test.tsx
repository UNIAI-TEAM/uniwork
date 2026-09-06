import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { DashboardGuard } from "./dashboard-guard";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

function nav(): NavigationAdapter {
  return { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/acme/team/tasks", searchParams: new URLSearchParams(), getShareableUrl: (p) => p };
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("DashboardGuard when the organization is suspended", () => {
  it("shows the notice instead of redirecting to the picker", async () => {
    requestMock.mockRejectedValue(new ApiError("suspended", "organization_suspended", 403));
    const adapter = nav();
    render(
      wrapWithNav(
        <DashboardGuard orgSlug="acme" wsSlug="team">
          {() => <p>workspace body</p>}
        </DashboardGuard>,
        adapter,
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Tổ chức đang tạm ngưng");
    expect(screen.getByRole("link", { name: "Về danh sách workspace" })).toHaveAttribute("href", "/workspaces");
    expect(screen.queryByText("workspace body")).not.toBeInTheDocument();
    expect(adapter.replace).not.toHaveBeenCalled();
  });
});
