import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import type { NavigationAdapter } from "../../navigation";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { SettingsPage } from "./settings-page";

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

function nav(search = ""): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/team/settings",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

const grant = {
  id: "g1",
  organization_id: "o1",
  organization_name: "Acme",
  user_id: "u1",
  user_name: "An",
  client_id: "c1",
  client_name: "Claude",
  verified: true,
  scope: "read",
  created_at: "2026-10-12T08:00:00Z",
  last_used_at: null,
};

function renderPage({ flag, role, search, grants = [] }: { flag: boolean; role: string; search?: string; grants?: unknown[] }) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
    if (path === "/api/v1/me/connected-apps") return Promise.resolve({ grants, mcp_url: "https://api.example.test/mcp" });
    return Promise.resolve({});
  });
  const service = new FeatureFlagService(new StaticProvider({ mcp_connector: { default: flag } }));
  return render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <SettingsPage />
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
      nav(search),
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("SettingsPage AI tabs", () => {
  it("lists both tabs for an organization owner while the connector flag is on", async () => {
    renderPage({ flag: true, role: "owner" });
    expect(await screen.findByRole("tab", { name: "Ứng dụng AI" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Truy cập AI" })).toBeInTheDocument();
    // The flag already decides: the page does not ask for the person's grants.
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/me/connected-apps");
  });

  it("hides the personal tab while the connector flag is off and the person has no grant, and keeps the organization one", async () => {
    renderPage({ flag: false, role: "owner" });
    expect(await screen.findByRole("tab", { name: "Truy cập AI" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Ứng dụng AI" })).not.toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/me/connected-apps"));
    expect(screen.queryByRole("tab", { name: "Ứng dụng AI" })).not.toBeInTheDocument();
  });

  // Ruling 50: an organization-level pilot connects a member whose own flag is
  // off. They must still find the app to see and revoke it.
  it("lists the personal tab with the flag off while the person holds a grant", async () => {
    const { unmount } = renderPage({ flag: false, role: "member", grants: [grant] });
    expect(await screen.findByRole("tab", { name: "Ứng dụng AI" })).toBeInTheDocument();
    unmount();
    renderPage({ flag: false, role: "member", grants: [grant], search: "tab=connected-apps" });
    expect(await screen.findByText("Claude")).toBeInTheDocument();
  });

  it("hides the organization tab from a member once the role is known", async () => {
    renderPage({ flag: true, role: "member" });
    expect(await screen.findByRole("tab", { name: "Ứng dụng AI" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Truy cập AI" })).not.toBeInTheDocument());
  });

  it("opens the personal tab from ?tab=connected-apps even with the flag off", async () => {
    renderPage({ flag: false, role: "member", search: "tab=connected-apps" });
    expect(await screen.findByRole("tab", { name: "Ứng dụng AI" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Ứng dụng AI đã kết nối", level: 2 })).toBeInTheDocument();
  });

  it("opens the organization tab from ?tab=ai-access", async () => {
    renderPage({ flag: true, role: "owner", search: "tab=ai-access" });
    expect(await screen.findByRole("tab", { name: "Truy cập AI" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Truy cập của trợ lý AI", level: 2 })).toBeInTheDocument();
  });
});
