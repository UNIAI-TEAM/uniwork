import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { AccountSettingsView } from "./account-settings-view";

initI18n();

/**
 * /settings (spec §4.5): with a workspace it is that workspace's settings,
 * the query kept whole; without one it stands on its own with the security
 * tab; signed out it is a sign-in that comes back here.
 */
const USER = {
  id: "u1", email: "an@company.vn", display_name: "An", onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi", has_password: true,
};
const WS = { id: "w1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme" };
const METHODS = {
  password: { set: true, changed_at: null },
  google: { linked: false, email: null, linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};

function serve(workspaces: unknown[], organizations: unknown[]) {
  requestMock.mockImplementation(async (path: string) => {
    if (path === "/api/v1/workspaces") return { workspaces };
    if (path === "/api/v1/orgs") return { organizations };
    if (path === "/api/v1/me/sign-in-methods") return METHODS;
    if (path === "/api/v1/auth/providers") return { google: true, apple: false, apple_web: false, google_native: false };
    if (path === "/api/v1/me/sessions") return { sessions: [] };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

describe("AccountSettingsView", () => {
  it("sends a person with a workspace on to its settings, the query kept", async () => {
    setSessionUser(USER);
    serve([WS], [{ id: "o1", slug: "acme", name: "Acme", status: "active", role: "member" }]);
    const nav = fakeNav("/settings?tab=security&expect_user=u1");
    render(wrapWithNav(<AccountSettingsView />, nav));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=security&expect_user=u1"));
    expect(screen.queryByRole("heading", { name: "Phương thức đăng nhập" })).toBeNull();
  });

  it("stands on its own, with the security tab, for a person without a workspace", async () => {
    setSessionUser(USER);
    serve([], []);
    const nav = fakeNav("/settings?tab=security");
    render(wrapWithNav(<AccountSettingsView />, nav));
    expect(screen.getByRole("heading", { name: "Cài đặt tài khoản", level: 1 })).toBeInTheDocument();
    // The tab is a lazy chunk, as in the workspace settings: the first import is slow under test.
    expect(await screen.findByRole("heading", { name: "Phương thức đăng nhập" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Đổi mật khẩu" })).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Quay lại" }).click();
    expect(nav.push).toHaveBeenCalledWith("/workspaces");
  });

  it("signs a signed-out visitor in, and brings them back", async () => {
    useAuthStore.setState({ user: null, status: "anon" });
    serve([], []);
    const nav = fakeNav("/settings?tab=security");
    render(wrapWithNav(<AccountSettingsView />, nav));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login?next=%2Fsettings%3Ftab%3Dsecurity"));
  });
});
