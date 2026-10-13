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

function renderPage({ flag, role, search }: { flag: boolean; role: string; search?: string }) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
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
  });

  it("hides the personal tab while the connector flag is off, and keeps the organization one", async () => {
    renderPage({ flag: false, role: "owner" });
    expect(await screen.findByRole("tab", { name: "Truy cập AI" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Ứng dụng AI" })).not.toBeInTheDocument();
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
