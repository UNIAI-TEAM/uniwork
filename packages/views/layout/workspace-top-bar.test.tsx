import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { useSearchStore } from "@uniwork/core/search";
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
  it("renders compact create with separate theme and language menus", () => {
    renderTopBar();
    const create = screen.getByRole("button", { name: /tạo việc/i });
    expect(create).toHaveTextContent("");
    expect(create).toHaveClass("h-8", "w-8");
    expect(screen.getByLabelText(/giao diện/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ngôn ngữ/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tùy chọn/i })).toBeNull();
    expect(screen.getByRole("button", { name: /ẩn\/hiện thanh bên|toggle sidebar/i })).toBeInTheDocument();
  });

  it("names the language preference in the toast, in the language just chosen", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "t");
    await setLocale("vi");
    renderTopBar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/ngôn ngữ/i));
    await user.click(await screen.findByRole("menuitemradio", { name: /english/i }));
    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(success.mock.calls[0]?.[0]).toBe("Language preference saved");
    success.mockRestore();
    await setLocale("vi");
  });

  it("puts the search trigger right after the sidebar toggle and opens the palette", () => {
    useSearchStore.setState({ open: false });
    renderTopBar();
    const toggle = screen.getByRole("button", { name: /ẩn\/hiện thanh bên|toggle sidebar/i });
    const search = screen.getByRole("button", { name: /tìm kiếm/i });
    expect(toggle.nextElementSibling).toBe(search);
    fireEvent.click(search);
    expect(useSearchStore.getState().open).toBe(true);
    useSearchStore.setState({ open: false });
  });
});
