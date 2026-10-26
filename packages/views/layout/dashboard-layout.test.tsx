import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getCurrentSlug, getCurrentWsId, setCurrentWorkspace } from "@uniwork/core/platform";
import {
  TASK_SURFACE_VIEW_STORAGE_KEY,
  getTaskSurfaceViewStore,
} from "@uniwork/core/tasks/stores/surface-view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { DashboardLayout } from "./dashboard-layout";

initI18n();

const user = { id: "u1", email: "a@b.c", display_name: "A" } as User;
const workspace = { id: "ws_team", slug: "team", organization_id: "org_acme", organization_slug: "acme", name: "Team" } as Workspace;

// The shell's chrome needs live queries and a socket; this suite is only about
// what the layout wires once the guard has resolved the workspace.
vi.mock("./dashboard-guard", () => ({
  DashboardGuard: ({ children }: { children: (ctx: { user: User; workspace: Workspace }) => ReactNode }) =>
    children({ user, workspace }),
}));
vi.mock("@uniwork/core/realtime", () => ({ WSProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@uniwork/core/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/core/feature-flags")>()),
  PublicConfigFlagsProvider: ({ organizationId, children }: { organizationId?: string; children: ReactNode }) => (
    <div data-testid="flags-scope" data-organization={organizationId}>
      {children}
    </div>
  ),
}));
vi.mock("../chat/chat-voice-call-host", () => ({ ChatVoiceCallHost: ({ children }: { children: ReactNode }) => children }));
vi.mock("./workspace-realtime-sync", () => ({ WorkspaceRealtimeSync: () => null }));
vi.mock("./workspace-chat-presence", () => ({ WorkspaceChatPresence: () => null }));
vi.mock("./workspace-chat-attention", () => ({ WorkspaceChatAttention: () => null }));
vi.mock("./entitlement-gate-toast", () => ({ EntitlementGateToastHost: () => null }));
vi.mock("./app-sidebar", () => ({ AppSidebar: () => <div data-testid="app-sidebar" /> }));
vi.mock("./workspace-rail", () => ({ WorkspaceRail: () => <div data-testid="workspace-rail" /> }));
vi.mock("./workspace-chat-toast", () => ({ WorkspaceChatToast: () => null }));
vi.mock("./browser-notifications-prompt", () => ({ BrowserNotificationsPrompt: () => null }));
vi.mock("./navigation-progress", () => ({ NavigationProgress: () => null }));
vi.mock("./browser-notifications-prompt", () => ({ BrowserNotificationsPrompt: () => null }));
vi.mock("./workspace-top-bar", () => ({
  WorkspaceChrome: ({
    children,
    bare,
    nav,
    frame,
  }: {
    children: ReactNode;
    bare?: boolean;
    nav?: ReactNode;
    frame: (content: ReactNode) => ReactNode;
  }) => (
    <div data-testid="chrome" data-bare={String(Boolean(bare))}>
      {nav}
      {frame(children)}
    </div>
  ),
}));

const flush = async () => {
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
};

beforeEach(async () => {
  localStorage.clear();
  setCurrentWorkspace(null, null);
  await flush();
});

afterEach(async () => {
  cleanup();
  setCurrentWorkspace(null, null);
  await flush();
});

describe("DashboardLayout workspace storage scope", () => {
  it("activates the URL workspace for workspace-scoped persisted state", async () => {
    render(
      <DashboardLayout orgSlug="acme" wsSlug="team">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    expect(screen.getByText("workspace body")).toBeInTheDocument();
    expect(getCurrentSlug()).toBe("acme/team");
    expect(getCurrentWsId()).toBe("ws_team");
  });

  it("lets a task surface's view choice reach storage so it survives a reload", async () => {
    render(
      <DashboardLayout orgSlug="acme" wsSlug="team">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    await flush();

    getTaskSurfaceViewStore("workspace:tasks").getState().setViewMode("table");

    const raw = localStorage.getItem(`${TASK_SURFACE_VIEW_STORAGE_KEY}:acme/team`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as {
      state: { surfaces: Record<string, { state: { viewMode: string } }> };
    };
    expect(parsed.state.surfaces["workspace:tasks"]?.state.viewMode).toBe("table");
  });
});

describe("DashboardLayout flags", () => {
  it("evaluates public flags for the workspace's organization", () => {
    render(
      <DashboardLayout orgSlug="acme" wsSlug="team">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    expect(screen.getByTestId("flags-scope")).toHaveAttribute("data-organization", "org_acme");
    expect(screen.getByTestId("flags-scope")).toContainElement(screen.getByText("workspace body"));
  });
});

describe("DashboardLayout variant", () => {
  it("renders the full sidebar and the top bar by default", () => {
    render(
      <DashboardLayout orgSlug="acme" wsSlug="team">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-rail")).toBeNull();
    expect(screen.getByTestId("chrome")).toHaveAttribute("data-bare", "false");
  });

  it("swaps the sidebar for the workspace rail and drops the top bar in chat-only", () => {
    render(
      <DashboardLayout orgSlug="acme" wsSlug="team" variant="chat-only">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    expect(screen.getByTestId("workspace-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect(screen.getByTestId("chrome")).toHaveAttribute("data-bare", "true");
  });
});

describe("DashboardLayout frame", () => {
  // A hidden frame still scrolls under scrollIntoView/focus once an sr-only
  // node inside a page's scroller overflows it; clip cannot scroll at all.
  it("clips the main frame instead of hiding its overflow", () => {
    render(
      <DashboardLayout orgSlug="acme" wsSlug="team">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    const main = screen.getByRole("main");
    expect(main).toHaveClass("overflow-clip");
    expect(main).not.toHaveClass("overflow-hidden");
  });

  it("leaves the desktop workspace frame to its cards, and keeps chat-only's canvas", () => {
    const view = render(
      <DashboardLayout orgSlug="acme" wsSlug="team">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    expect(screen.getByRole("main")).toHaveClass("lg:bg-transparent");
    view.unmount();
    render(
      <DashboardLayout orgSlug="acme" wsSlug="team" variant="chat-only">
        <p>workspace body</p>
      </DashboardLayout>,
    );
    expect(screen.getByRole("main")).not.toHaveClass("lg:bg-transparent");
  });
});
