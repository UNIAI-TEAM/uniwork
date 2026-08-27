import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import type { User, Workspace } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTopBar } from "./workspace-top-bar";

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
};
const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const localeAdapter = {
  getUserChoice: () => "vi" as const,
  getSystemPreferences: () => ["vi"],
  persist: vi.fn(),
};

beforeEach(() => {
  localeAdapter.persist.mockClear();
});

function renderTopBar() {
  return render(
    wrapWithNav(
      <ThemeProvider>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <SidebarProvider hasExternalTrigger>
              <WorkspaceTopBar createOpen={false} onCreateOpenChange={() => {}} />
            </SidebarProvider>
          </WorkspaceProvider>
        </LocaleAdapterProvider>
      </ThemeProvider>,
    ),
  );
}

describe("WorkspaceTopBar", () => {
  it("renders create task, theme and language controls without the search pill", () => {
    renderTopBar();
    expect(screen.queryByRole("button", { name: /tìm kiếm/i })).toBeNull();
    expect(screen.getByRole("button", { name: /tạo việc/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/giao diện/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ngôn ngữ/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ẩn\/hiện thanh bên|toggle sidebar/i })).toBeInTheDocument();
  });
});
