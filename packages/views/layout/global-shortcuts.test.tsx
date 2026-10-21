import { StrictMode, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import { useSearchStore } from "@uniwork/core/search";
import {
  configureShortcutPlatform,
  createShortcutChord,
  DOCUMENT_EDITOR_SCOPE,
  DOCUMENT_EDITOR_SCOPE_ATTRIBUTE,
  useShortcutStore,
} from "@uniwork/core/shortcuts";
import type { User, Workspace } from "@uniwork/core/types";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { Dialog, DialogContent, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { SidebarProvider, useSidebar } from "@uniwork/ui/components/ui/sidebar";
import type { NavigationAdapter } from "../navigation";
import { SearchCommand } from "../search";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { GlobalShortcuts } from "./global-shortcuts";
import { WorkspaceProvider } from "./workspace-context";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const originalSearchToggle = useSearchStore.getState().toggle;
const originalAiToggle = useAiPanelStore.getState().toggle;

function nav(overrides: Partial<NavigationAdapter> = {}): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    pathname: "/acme/team/tasks/t1",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
    ...overrides,
  };
}

function mockCapabilities(enabled: boolean) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces/ws1/ai/capabilities") {
      return Promise.resolve({ enabled, ask_uni: enabled, meeting_summary: enabled, quota: { used_tokens: 0, limit_tokens: 1 } });
    }
    return Promise.resolve({});
  });
}

/** Shares the dispatcher's query cache, so a test can wait until capabilities are known. */
function CapabilitiesProbe() {
  const caps = useAiCapabilities(workspace.id);
  return caps.isSuccess ? <span data-testid="caps-loaded" /> : null;
}

function mount(
  children: ReactNode,
  { adapter = nav(), onCreateTask = vi.fn() }: { adapter?: NavigationAdapter; onCreateTask?: () => void } = {},
) {
  const view = render(
    wrapWithNav(
      <ThemeProvider>
        <WorkspaceProvider workspace={workspace} user={user}>
          <GlobalShortcuts onCreateTask={onCreateTask} />
          <CapabilitiesProbe />
          {children}
        </WorkspaceProvider>
      </ThemeProvider>,
      adapter,
    ),
  );
  return { ...view, adapter, onCreateTask };
}

function countSearchToggles() {
  const toggle = vi.fn(() => useSearchStore.setState((s) => ({ open: !s.open })));
  useSearchStore.setState({ toggle });
  return toggle;
}

function countAiToggles() {
  const toggle = vi.fn(() => useAiPanelStore.setState((s) => ({ open: !s.open })));
  useAiPanelStore.setState({ toggle });
  return toggle;
}

function press(target: Element | Document, key: string, init: KeyboardEventInit = {}) {
  return fireEvent.keyDown(target, { key, ...init });
}

beforeEach(() => {
  configureShortcutPlatform("macos");
  requestMock.mockReset();
  mockCapabilities(true);
  useSearchStore.setState({ open: false, toggle: originalSearchToggle });
  useAiPanelStore.setState({ open: false, conversationId: null, toggle: originalAiToggle });
  useShortcutStore.getState().resetAll();
});

afterEach(() => {
  configureShortcutPlatform(null);
  useShortcutStore.getState().resetAll();
  useSearchStore.setState({ open: false, toggle: originalSearchToggle });
  useAiPanelStore.setState({ open: false, toggle: originalAiToggle });
});

describe("GlobalShortcuts: create task", () => {
  it("runs createTask once for C pressed on the page", () => {
    const { onCreateTask } = mount(null);
    press(document.body, "c");
    expect(onCreateTask).toHaveBeenCalledTimes(1);
  });

  it("ignores C typed into a textarea, an input or a contenteditable element", () => {
    const { onCreateTask } = mount(
      <>
        <textarea aria-label="note" />
        <input aria-label="name" />
        <div data-testid="rich" contentEditable="true" suppressContentEditableWarning>
          <p data-testid="rich-child">x</p>
        </div>
      </>,
    );
    press(screen.getByRole("textbox", { name: "note" }), "c");
    press(screen.getByRole("textbox", { name: "name" }), "c");
    press(screen.getByTestId("rich"), "c");
    press(screen.getByTestId("rich-child"), "c");
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it("ignores C pressed inside an open menu", () => {
    const { onCreateTask } = mount(
      <div role="menu">
        <button type="button" role="menuitem">item</button>
      </div>,
    );
    press(screen.getByRole("menuitem"), "c");
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it("does nothing for an event a focused control already handled", () => {
    const { onCreateTask } = mount(<button type="button">own</button>);
    const own = screen.getByRole("button", { name: "own" });
    own.addEventListener("keydown", (e) => e.preventDefault());
    press(own, "c");
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it("follows a rebinding from the shortcut store without a reload", () => {
    const { onCreateTask } = mount(null);
    useShortcutStore.getState().setShortcut("createTask", createShortcutChord("N"));
    press(document.body, "c");
    expect(onCreateTask).not.toHaveBeenCalled();
    press(document.body, "n");
    expect(onCreateTask).toHaveBeenCalledTimes(1);
  });

  it("does not double the action after a StrictMode remount", () => {
    const onCreateTask = vi.fn();
    render(
      <StrictMode>
        {wrapWithNav(
          <WorkspaceProvider workspace={workspace} user={user}>
            <GlobalShortcuts onCreateTask={onCreateTask} />
          </WorkspaceProvider>,
          nav(),
        )}
      </StrictMode>,
    );
    press(document.body, "c");
    expect(onCreateTask).toHaveBeenCalledTimes(1);
  });
});

describe("GlobalShortcuts: search palette", () => {
  it("toggles search once for ⌘K pressed inside an input", () => {
    const toggle = countSearchToggles();
    mount(<input aria-label="name" />);
    const event = press(screen.getByRole("textbox", { name: "name" }), "k", { metaKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
  });

  it("toggles search exactly once while SearchCommand is mounted too", () => {
    const toggle = countSearchToggles();
    mount(<SearchCommand onCreateTask={() => {}} />);
    press(document.body, "k", { metaKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().open).toBe(true);
  });

  it("closes the open palette with ⌘K typed in its search field", async () => {
    useSearchStore.setState({ open: true });
    mount(<SearchCommand onCreateTask={() => {}} />);
    const field = screen.getByPlaceholderText("Gõ trang hoặc lệnh…");
    field.focus();
    press(field, "k", { metaKey: true });
    await waitFor(() => expect(useSearchStore.getState().open).toBe(false));
  });

  it("still opens search under a modal layer, while C stays blocked there", async () => {
    const toggle = countSearchToggles();
    const { onCreateTask } = mount(
      <Dialog open>
        <DialogContent>
          <DialogTitle>modal</DialogTitle>
          <input aria-label="inside" />
        </DialogContent>
      </Dialog>,
    );
    await waitFor(() => expect(document.querySelector("[data-base-ui-inert]")).not.toBeNull());
    press(document.body, "c");
    press(screen.getByRole("textbox", { name: "inside" }), "c");
    expect(onCreateTask).not.toHaveBeenCalled();
    press(screen.getByRole("textbox", { name: "inside" }), "k", { metaKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe("GlobalShortcuts: Ask UNI", () => {
  it("toggles the Ask UNI panel with ⌘J from a textarea when AI is enabled", async () => {
    const toggle = countAiToggles();
    mount(<textarea aria-label="note" />);
    await screen.findByTestId("caps-loaded");
    const event = press(screen.getByRole("textbox", { name: "note" }), "j", { metaKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
  });

  it("leaves ⌘J alone, unprevented, when the workspace has no AI", async () => {
    mockCapabilities(false);
    const toggle = countAiToggles();
    mount(null);
    await screen.findByTestId("caps-loaded");
    const event = press(document.body, "j", { metaKey: true });
    expect(toggle).not.toHaveBeenCalled();
    expect(event).toBe(true);
  });
});

describe("GlobalShortcuts: navigation", () => {
  it("goes back with ⌘[ and forward with ⌘]", () => {
    const { adapter } = mount(null);
    press(document.body, "[", { metaKey: true });
    expect(adapter.back).toHaveBeenCalledTimes(1);
    press(document.body, "]", { metaKey: true });
    expect(adapter.forward).toHaveBeenCalledTimes(1);
  });

  it("treats ⌘] as a no-op when the host has no forward", () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error);
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      mount(null, { adapter: nav({ forward: undefined }) });
      press(document.body, "]", { metaKey: true });
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(errors).toEqual([]);
  });

  it("pushes the workspace path of a go action bound in the store", () => {
    useShortcutStore.getState().setShortcut("goTasks", createShortcutChord("G"));
    useShortcutStore.getState().setShortcut("goSettings", createShortcutChord("S"));
    const { adapter } = mount(null);
    press(document.body, "g");
    expect(adapter.push).toHaveBeenCalledWith("/acme/team/tasks");
    press(document.body, "s");
    expect(adapter.push).toHaveBeenCalledWith("/acme/team/settings");
  });

  it("does not push the page you are already on", () => {
    useShortcutStore.getState().setShortcut("goTasks", createShortcutChord("G"));
    const { adapter } = mount(null, { adapter: nav({ pathname: "/acme/team/tasks" }) });
    press(document.body, "g");
    expect(adapter.push).not.toHaveBeenCalled();
  });
});

describe("GlobalShortcuts: the document editor wins", () => {
  // The UniNote page editor marks its DOM with the document-editor scope; a
  // chat or task composer is a contenteditable too but keeps the global chords.
  const pageEditor = (
    <div data-testid="page" contentEditable="true" suppressContentEditableWarning
      {...{ [DOCUMENT_EDITOR_SCOPE_ATTRIBUTE]: DOCUMENT_EDITOR_SCOPE }}>
      <p data-testid="page-line">text</p>
    </div>
  );
  const composer = <div data-testid="composer" contentEditable="true" suppressContentEditableWarning><p>draft</p></div>;

  it("lets Ctrl+K, Ctrl+J, Ctrl+[ and Ctrl+] through to the page editor, unprevented", async () => {
    const search = countSearchToggles();
    const ai = countAiToggles();
    const { adapter } = mount(pageEditor);
    await screen.findByTestId("caps-loaded");
    for (const [key, platform] of [["k", "macos"], ["j", "macos"], ["[", "macos"], ["]", "macos"], ["k", "windows"], ["j", "windows"], ["[", "windows"], ["]", "windows"]] as const) {
      configureShortcutPlatform(platform);
      const init = platform === "macos" ? { metaKey: true } : { ctrlKey: true };
      expect(press(screen.getByTestId("page-line"), key, init), `${platform} ${key}`).toBe(true);
    }
    expect(search).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
    expect(adapter.back).not.toHaveBeenCalled();
    expect(adapter.forward).not.toHaveBeenCalled();
  });

  it("still opens search and Ask UNI from a composer and from outside any editor", async () => {
    const search = countSearchToggles();
    const ai = countAiToggles();
    mount(composer);
    await screen.findByTestId("caps-loaded");
    press(screen.getByTestId("composer"), "k", { metaKey: true });
    press(screen.getByTestId("composer"), "j", { metaKey: true });
    press(document.body, "k", { metaKey: true });
    press(document.body, "j", { metaKey: true });
    expect(search).toHaveBeenCalledTimes(2);
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it("still goes back and forward outside editors", () => {
    const { adapter } = mount(pageEditor);
    press(document.body, "[", { metaKey: true });
    press(document.body, "]", { metaKey: true });
    expect(adapter.back).toHaveBeenCalledTimes(1);
    expect(adapter.forward).toHaveBeenCalledTimes(1);
  });

  it("never reaches the host from inside an Office frame, a separate document", async () => {
    const search = countSearchToggles();
    const ai = countAiToggles();
    const { adapter } = mount(<iframe title="office frame" data-testid="frame" />);
    await screen.findByTestId("caps-loaded");
    const frameDoc = (screen.getByTestId("frame") as HTMLIFrameElement).contentDocument!;
    for (const key of ["k", "j", "[", "]", "b"]) {
      frameDoc.body.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true }));
    }
    frameDoc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }));
    expect(search).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
    expect(adapter.back).not.toHaveBeenCalled();
    expect(adapter.forward).not.toHaveBeenCalled();
  });
});

describe("GlobalShortcuts: IME and AltGr", () => {
  it("ignores every global chord while an IME is composing", async () => {
    const search = countSearchToggles();
    const ai = countAiToggles();
    const { adapter, onCreateTask } = mount(null);
    await screen.findByTestId("caps-loaded");
    for (const key of ["k", "j", "[", "]"]) {
      press(document.body, key, { metaKey: true, isComposing: true });
      press(document.body, key, { metaKey: true, keyCode: 229 });
    }
    press(document.body, "c", { isComposing: true });
    press(document.body, "c", { keyCode: 229 });
    expect(search).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
    expect(adapter.back).not.toHaveBeenCalled();
    expect(adapter.forward).not.toHaveBeenCalled();
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it("ignores a chord typed with AltGr, which is Ctrl+Alt on Windows layouts", async () => {
    configureShortcutPlatform("windows");
    const search = countSearchToggles();
    const ai = countAiToggles();
    const { adapter } = mount(null);
    await screen.findByTestId("caps-loaded");
    for (const key of ["k", "j", "[", "]"]) {
      press(document.body, key, { ctrlKey: true, altKey: true, modifierAltGraph: true });
    }
    expect(search).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
    expect(adapter.back).not.toHaveBeenCalled();
    expect(adapter.forward).not.toHaveBeenCalled();
  });
});

describe("GlobalShortcuts: sidebar Ctrl+B", () => {
  function SidebarState() {
    return <span data-testid="sidebar-open">{String(useSidebar().open)}</span>;
  }

  it("toggles outside editors and stands down in the page editor, where Bold wins", () => {
    mount(
      <SidebarProvider>
        <SidebarState />
        <div data-testid="page" contentEditable="true" suppressContentEditableWarning
          {...{ [DOCUMENT_EDITOR_SCOPE_ATTRIBUTE]: DOCUMENT_EDITOR_SCOPE }}>
          <p data-testid="page-line">text</p>
        </div>
      </SidebarProvider>,
    );
    const open = () => screen.getByTestId("sidebar-open").textContent;
    const before = open();
    // jsdom does not implement isContentEditable, which the sidebar primitive reads.
    Object.defineProperty(screen.getByTestId("page"), "isContentEditable", { value: true });
    press(screen.getByTestId("page"), "b", { metaKey: true });
    expect(open()).toBe(before);
    press(document.body, "b", { metaKey: true });
    expect(open()).not.toBe(before);
  });
});
