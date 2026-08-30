import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { useSearchStore } from "@uniwork/core/search";
import type { User, Workspace } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { SearchCommand } from "./search-command";

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {}, locale: "vi",
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
  getUserChoice: () => "vi",
  getSystemPreferences: () => ["vi"],
  persist: vi.fn(),
};

beforeEach(() => {
  useSearchStore.setState({ open: false });
  localeAdapter.persist.mockClear();
});

describe("SearchCommand", () => {
  it("opens from the store and lists workspace pages", () => {
    useSearchStore.setState({ open: true });
    render(
      wrapWithNav(
        <ThemeProvider>
          <LocaleAdapterProvider adapter={localeAdapter}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SearchCommand onCreateTask={() => {}} />
            </WorkspaceProvider>
          </LocaleAdapterProvider>
        </ThemeProvider>,
      ),
    );
    expect(screen.getByPlaceholderText("Gõ trang hoặc lệnh…")).toBeInTheDocument();
    expect(screen.getByText("Công việc")).toBeInTheDocument();
    expect(screen.getByText("Cuộc họp")).toBeInTheDocument();
    expect(screen.getByText("Cài đặt")).toBeInTheDocument();
  });
});
