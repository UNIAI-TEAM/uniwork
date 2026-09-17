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
const workspace = { id: "ws_team", slug: "team", organization_slug: "acme", name: "Team" } as Workspace;

// The shell's chrome needs live queries and a socket; this suite is only about
// what the layout wires once the guard has resolved the workspace.
vi.mock("./dashboard-guard", () => ({
  DashboardGuard: ({ children }: { children: (ctx: { user: User; workspace: Workspace }) => ReactNode }) =>
    children({ user, workspace }),
}));
vi.mock("@uniwork/core/realtime", () => ({ WSProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../chat/chat-voice-call-host", () => ({ ChatVoiceCallHost: ({ children }: { children: ReactNode }) => children }));
vi.mock("./workspace-realtime-sync", () => ({ WorkspaceRealtimeSync: () => null }));
vi.mock("./app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("./navigation-progress", () => ({ NavigationProgress: () => null }));
vi.mock("./workspace-top-bar", () => ({ WorkspaceChrome: ({ children }: { children: ReactNode }) => children }));

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
