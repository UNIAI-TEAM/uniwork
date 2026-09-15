import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import type { User, Workspace } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceChrome, WorkspaceTopBar } from "./workspace-top-bar";

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

describe("WorkspaceChrome", () => {
  it("opens the new task dialog when C is pressed on the page", async () => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
    render(
      wrapWithNav(
        <ThemeProvider>
          <LocaleAdapterProvider adapter={localeAdapter}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SidebarProvider hasExternalTrigger>
                <WorkspaceChrome>
                  <p>page</p>
                </WorkspaceChrome>
              </SidebarProvider>
            </WorkspaceProvider>
          </LocaleAdapterProvider>
        </ThemeProvider>,
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "c" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("WorkspaceTopBar", () => {
  it("renders compact create and one preferences menu without the search pill", () => {
    renderTopBar();
    expect(screen.queryByRole("button", { name: /tìm kiếm/i })).toBeNull();
    const create = screen.getByRole("button", { name: /tạo việc/i });
    expect(create).toHaveTextContent("");
    expect(create).toHaveClass("h-8", "w-8");
    expect(screen.queryByLabelText(/giao diện/i)).toBeNull();
    expect(screen.queryByLabelText(/ngôn ngữ/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /tùy chọn/i }));
    expect(screen.getByText("Giao diện")).toBeInTheDocument();
    expect(screen.getByText("Ngôn ngữ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ẩn\/hiện thanh bên|toggle sidebar/i })).toBeInTheDocument();
  });
});
