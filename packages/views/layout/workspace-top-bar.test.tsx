import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useAiPanelStore } from "@uniwork/core/ai";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { useSearchStore } from "@uniwork/core/search";
import type { User, Workspace } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { useNavigation } from "../navigation";
import { useEffect } from "react";
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


  it("mounts the next page once when the route changes", async () => {
    // The host's children slot always renders the current route, like Next's
    // layout router: a page kept on screen while the old route animates out
    // would mount the new route there first, then again once the exit ends,
    // and a deep link that page consumed on its first mount would be lost.
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
    const mounts: string[] = [];
    function Page({ name }: { name: string }) {
      useEffect(() => {
        mounts.push(name);
      }, [name]);
      return <p>{name}</p>;
    }
    // Each route is its own component, so a new route mounts a new page.
    const DocumentsPage = () => <Page name="documents" />;
    const ChatPage = () => <Page name="chat" />;
    function Route() {
      const { pathname } = useNavigation();
      return pathname.endsWith("/chat") ? <ChatPage /> : <DocumentsPage />;
    }
    const nav = fakeNav("/acme/team/documents");
    render(
      wrapWithNav(
        <ThemeProvider>
          <LocaleAdapterProvider adapter={localeAdapter}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SidebarProvider hasExternalTrigger>
                <WorkspaceChrome>
                  <Route />
                </WorkspaceChrome>
              </SidebarProvider>
            </WorkspaceProvider>
          </LocaleAdapterProvider>
        </ThemeProvider>,
        nav,
      ),
    );
    act(() => nav.push("/acme/team/chat?room=r1&message=m1"));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mounts).toEqual(["documents", "chat"]);
  });
});

describe("WorkspaceTopBar", () => {
  it("renders compact create with separate theme and language menus", () => {
    renderTopBar();
    const create = screen.getByRole("button", { name: /tạo việc/i });
    expect(create).toHaveTextContent("");
    expect(create).toHaveClass("size-8");
    expect(screen.getByRole("button", { name: "Giao diện" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ngôn ngữ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tùy chọn/i })).toBeNull();
  });

  it("draws every top-bar action at one size and tone, in one tight cluster", () => {
    renderTopBar();
    const create = screen.getByRole("button", { name: /tạo việc/i });
    const cluster = create.parentElement;
    expect(cluster).toHaveClass("gap-0.5");
    const actions = within(cluster as HTMLElement).getAllByRole("button");
    expect(actions.length).toBeGreaterThanOrEqual(5);
    for (const action of actions) {
      expect(action).toHaveClass("size-8", "text-muted-foreground");
      // The tone sits on the button, so the ghost hover can lift the glyph.
      expect(action.querySelector("svg")).not.toHaveClass("text-muted-foreground");
    }
    const search = screen.getByRole("button", { name: /tìm kiếm/i });
    expect(search.querySelector("svg")).toHaveAttribute("stroke-width", "2");
  });

  it("names the language preference in the toast, in the language just chosen", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "t");
    await setLocale("vi");
    renderTopBar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ngôn ngữ" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /english/i }));
    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(success.mock.calls[0]?.[0]).toBe("Language preference saved");
    success.mockRestore();
    await setLocale("vi");
  });

  it("folds theme and language into one menu on a narrow bar, and keeps the four reach actions out", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "t");
    await setLocale("vi");
    const { container } = renderTopBar();
    // The bar is a rem query container: below 21rem (a phone at large text)
    // the two menus swap for one and the actions wrap with the bar's row,
    // so nothing runs off the edge.
    const header = container.querySelector("header");
    expect(header).toHaveClass("@container/topbar", "flex-wrap", "min-h-12");
    const create = screen.getByRole("button", { name: /tạo việc/i });
    expect(create.parentElement).toHaveClass("@max-[21rem]/topbar:contents");
    expect(screen.getByRole("button", { name: "Giao diện" })).toHaveClass("hidden", "@min-[21rem]/topbar:inline-flex");
    expect(screen.getByRole("button", { name: "Ngôn ngữ" })).toHaveClass("hidden", "@min-[21rem]/topbar:inline-flex");
    const more = screen.getByRole("button", { name: "Giao diện và ngôn ngữ" });
    expect(more).toHaveClass("@min-[21rem]/topbar:hidden", "size-8", "text-muted-foreground");
    // Search, AI, notifications and + New never fold (PRODUCT.md principle 8).
    // (Ask UNI renders only once the AI capability answers; not here.)
    for (const name of [/tìm kiếm/i, /thông báo/i, /tạo việc/i]) {
      expect(screen.getByRole("button", { name })).not.toHaveClass("hidden");
    }

    const user = userEvent.setup();
    await user.click(more);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("group", { name: "Giao diện" })).toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Ngôn ngữ" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitemradio", { name: /english/i }));
    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(localeAdapter.persist).toHaveBeenCalledWith("en");
    success.mockRestore();
    await setLocale("vi");
  });

  it("on a desktop bar, holds the workspace switcher, search and account, and leaves the sidebar toggle to the sidebar", async () => {
    useSearchStore.setState({ open: false });
    const { container } = renderTopBar();
    // The bar sits on the app plane, outside every card (ClickUp-style shell).
    expect(container.querySelector("header")).toHaveClass("lg:bg-transparent", "lg:border-b-0");
    expect(screen.queryByRole("button", { name: /ẩn\/hiện thanh bên|toggle sidebar/i })).toBeNull();
    const switcher = await screen.findByRole("button", { name: "Acme, Team: chuyển workspace" });
    // One line at a nav row's size: the organization stays in the name and the menu, not a second line.
    expect(within(switcher).queryByText("Acme")).toBeNull();
    expect(within(switcher).getByText("Team")).toHaveClass("text-body", "font-medium");
    const search = screen.getByRole("button", { name: /tìm kiếm/i });
    const account = screen.getByRole("button", { name: "An, a@b.c: tài khoản" });
    expect(switcher.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(search);
    expect(useSearchStore.getState().open).toBe(true);
    useSearchStore.setState({ open: false });
  });

  it("on a desktop bar, puts Ask UNI inside the search field as a pill with a brand gradient ring, as ClickUp's AI entry", async () => {
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/workspaces/ws1/ai/capabilities"
          ? { enabled: true, ask_uni: true, meeting_summary: true, quota: { used_tokens: 0, limit_tokens: 500000 } }
          : {},
      ),
    );
    renderTopBar();
    const ask = await screen.findByRole("button", { name: "Hỏi UNI" });
    expect(ask).toHaveTextContent("Hỏi UNI");
    expect(ask).toHaveClass("rounded-full", "isolate");
    expect(ask.querySelector("svg")).not.toBeNull();
    // The ring is drawn from the brand tokens and only turns on hover or focus, never under reduced motion.
    const ring = ask.querySelector('[data-slot="ask-uni-ring"]');
    expect(ring?.className).toContain("var(--brand)");
    expect(ring?.className).toContain("var(--brand-accent)");
    expect(ring).toHaveClass("motion-safe:group-hover/ai:animate-[spin_1.5s_linear_infinite]");
    // One field: the search trigger and the pill share it, search first.
    const search = screen.getByRole("button", { name: /tìm kiếm/i });
    const field = search.parentElement as HTMLElement;
    // A pill field, so the pill inside is concentric with it; hovering lifts the whole field, pill included.
    expect(field).toHaveClass(
      "group/field",
      "w-96",
      "rounded-full",
      "border-border",
      "bg-page-canvas",
      "hover:shadow-sm",
      "dark:hover:bg-surface-hover",
    );
    expect(search).toHaveClass("hover:bg-transparent", "rounded-s-full");
    expect(field.querySelector('[data-slot="ask-uni-cover"]')).toHaveClass("dark:group-hover/field:bg-surface-hover");
    expect(field).toContainElement(ask);
    expect(search.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const account = screen.getByRole("button", { name: "An, a@b.c: tài khoản" });
    // A 32px avatar with a chevron: the control reads as a menu, not a lone picture.
    expect(account.querySelector('[data-slot="account-chevron"]')).not.toBeNull();
    expect(account.querySelector('[data-slot="avatar"][style*="width: 32px"]')).not.toBeNull();
  });

  it("on a compact bar, puts the search trigger right after the sidebar toggle, and keeps switcher and account in the sheet", async () => {
    const width = window.innerWidth;
    window.innerWidth = 800;
    try {
      renderTopBar();
      const toggle = await screen.findByRole("button", { name: /ẩn\/hiện thanh bên|toggle sidebar/i });
      expect(toggle.nextElementSibling).toBe(screen.getByRole("button", { name: /tìm kiếm/i }));
      expect(screen.queryByRole("button", { name: /chuyển workspace/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /tài khoản$/ })).toBeNull();
    } finally {
      window.innerWidth = width;
    }
  });
});

describe("WorkspaceChrome Ask UNI", () => {
  function tree(service: FeatureFlagService, page: React.ReactNode, bare = false) {
    return wrapWithNav(
      <ThemeProvider>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SidebarProvider hasExternalTrigger>
                <WorkspaceChrome bare={bare}>{page}</WorkspaceChrome>
              </SidebarProvider>
            </WorkspaceProvider>
          </FeatureFlagsProvider>
        </LocaleAdapterProvider>
      </ThemeProvider>,
    );
  }

  function renderChrome(flagOn: boolean, bare = false) {
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/v1/workspaces/ws1/ai/capabilities"
          ? { enabled: true, ask_uni: true, meeting_summary: true, quota: { used_tokens: 0, limit_tokens: 500000 } }
          : {},
      ),
    );
    useAiPanelStore.setState({ open: true, conversationId: null, workspaceId: null });
    const service = new FeatureFlagService(new StaticProvider({ ask_uni_stream: { default: flagOn } }));
    return render(
      wrapWithNav(
        <ThemeProvider>
          <LocaleAdapterProvider adapter={localeAdapter}>
            <FeatureFlagsProvider service={service}>
              <WorkspaceProvider workspace={workspace} user={user}>
                <SidebarProvider hasExternalTrigger>
                  <WorkspaceChrome bare={bare}>
                    <p>page</p>
                  </WorkspaceChrome>
                </SidebarProvider>
              </WorkspaceProvider>
            </FeatureFlagsProvider>
          </LocaleAdapterProvider>
        </ThemeProvider>,
      ),
    );
  }

  it("keeps the overlay panel while the flag is off", async () => {
    renderChrome(false);
    expect(await screen.findByRole("dialog", { name: /Hỏi UNI/ })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Hỏi UNI" })).toBeNull();
  });

  it("docks the panel beside the page while the flag is on", async () => {
    renderChrome(true);
    expect(await screen.findByRole("complementary", { name: "Hỏi UNI" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Hỏi UNI/ })).toBeNull();
    expect(screen.getByText("page")).toBeVisible();
  });

  it("does not remount the page when the flag arrives after the shell mounted", async () => {
    let mounts = 0;
    function Page() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <p>page</p>;
    }
    const off = new FeatureFlagService(new StaticProvider({ ask_uni_stream: { default: false } }));
    const on = new FeatureFlagService(new StaticProvider({ ask_uni_stream: { default: true } }));
    const view = renderChrome(false);
    view.unmount();
    const r = render(tree(off, <Page />));
    await screen.findByText("page");
    r.rerender(tree(on, <Page />));
    expect(await screen.findByRole("complementary", { name: "Hỏi UNI" })).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it("keeps the overlay panel in the bare UniChat shell even with the flag on", async () => {
    renderChrome(true, true);
    expect(await screen.findByRole("dialog", { name: /Hỏi UNI/ })).toBeInTheDocument();
  });
});
