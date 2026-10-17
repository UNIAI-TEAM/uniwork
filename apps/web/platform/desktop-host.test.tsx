import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "@uniwork/core/api/endpoints/chat";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { getSessionProvider, setSessionUser } from "@uniwork/core/auth";
import { chatKeys } from "@uniwork/core/chat";
import { CoreProvider, type DesktopBridge } from "@uniwork/core/platform";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "@uniwork/views/layout/workspace-context";
import { DesktopHost, UniChatBadge, useIsUniChatHost } from "./desktop-host";
import { WebNavigationProvider } from "./navigation";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/acme/team/chat",
  useSearchParams: () => new URLSearchParams(),
}));

// The bridge is installed before any import so desktop-host's import-time
// registration sees it, the way the shell's preload runs before the page.
const bridge = vi.hoisted(() => {
  const b = {
    app: "unichat",
    appInfo: { version: "0.0.0", os: "macos" },
    session: {
      getAccessToken: vi.fn(() => Promise.resolve("tok")),
      refresh: vi.fn(() => Promise.resolve("tok")),
      logout: vi.fn(() => Promise.resolve()),
      onChange: vi.fn(() => () => {}),
    },
    setBadgeCount: vi.fn(),
    isFocused: vi.fn(() => Promise.resolve(true)),
    onFocusChange: vi.fn(() => () => {}),
    focusWindow: vi.fn(),
    openExternal: vi.fn(() => Promise.resolve()),
    downloadURL: vi.fn(() => Promise.resolve()),
    deepLink: null as ((url: string) => void) | null,
    onDeepLink: vi.fn((cb: (url: string) => void) => {
      b.deepLink = cb;
      return () => {
        b.deepLink = null;
      };
    }),
  };
  (window as unknown as { desktopAPI: unknown }).desktopAPI = b;
  return b;
});

// CoreProvider owns the QueryClient; capture the one it builds so the badge
// test can seed and patch the rooms list without a react-query import.
const captured = vi.hoisted(() => ({ qc: null as ReturnType<typeof import("@uniwork/core/query-client").createQueryClient> | null }));
vi.mock("@uniwork/core/query-client", async (orig) => {
  const mod = await orig<typeof import("@uniwork/core/query-client")>();
  return {
    ...mod,
    createQueryClient: () => {
      captured.qc = mod.createQueryClient();
      return captured.qc;
    },
  };
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const flushed = () => new Promise((resolve) => setTimeout(resolve, 0));

it("registers the shell's session and platform at import", () => {
  expect(getSessionProvider()).toBe(bridge.session);
  expect(runtimeConfig().clientPlatform).toBe("desktop");
});

describe("DesktopHost deep links", () => {
  it("pushes a sanitized in-app path from a uniworkchat:// link", async () => {
    await act(async () => root.render(<WebNavigationProvider><DesktopHost /></WebNavigationProvider>));
    expect(bridge.deepLink).not.toBeNull();

    bridge.deepLink?.("uniworkchat://open?url=/acme/team/chat?room=r1");
    await flushed();

    expect(router.push).toHaveBeenCalledWith("/acme/team/chat?room=r1");
  });

  it("hands a non-chat path to the browser and rewrites the landing page to chat", async () => {
    await act(async () => root.render(<WebNavigationProvider><DesktopHost /></WebNavigationProvider>));

    // The chat-only policy is wired by WebNavigationProvider, not by DesktopHost.
    bridge.deepLink?.("uniworkchat://open?url=/acme/team/documents/x");
    await flushed();
    expect(bridge.openExternal).toHaveBeenCalledWith(runtimeConfig().appUrl + "/acme/team/documents/x");
    expect(bridge.openExternal).toHaveBeenCalledWith("http://localhost:3000/acme/team/documents/x");
    expect(router.push).not.toHaveBeenCalled();

    bridge.deepLink?.("uniworkchat://open?url=/acme/team/tasks");
    await flushed();
    expect(router.push).toHaveBeenCalledWith("/acme/team/chat");
    expect(bridge.openExternal).toHaveBeenCalledTimes(1);
  });

  it("drops a link of another origin and unsubscribes on unmount", async () => {
    await act(async () => root.render(<WebNavigationProvider><DesktopHost /></WebNavigationProvider>));

    bridge.deepLink?.("https://evil.example/a");
    await flushed();
    expect(router.push).not.toHaveBeenCalled();

    act(() => root.unmount());
    expect(bridge.deepLink).toBeNull();
    root = createRoot(host);
  });
});

describe("UniChatBadge", () => {
  const user: User = {
    id: "u1", email: "a@b.c", display_name: "A", onboarded_at: "2026-01-01T00:00:00Z",
    email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
  };
  const workspace: Workspace = {
    id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
  };
  const room = (id: string, unread: number, mentions: number, muted = false): ChatRoomRecord => ({
    id, kind: "group", name: id, workspace_id: "ws1", member_user_ids: [], member_count: 0,
    unread_count: unread, mention_unread_count: mentions, notifications_muted: muted,
  });

  it("mirrors the unread badge count to the shell and follows cache changes", async () => {
    setSessionUser(user);
    vi.spyOn(chatApi, "listChatRooms").mockResolvedValue([room("a", 2, 0), room("m", 5, 1, true)]);
    await act(async () =>
      root.render(
        <CoreProvider initializeAuth={false}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <UniChatBadge />
          </WorkspaceProvider>
        </CoreProvider>,
      ),
    );
    await vi.waitFor(() => expect(bridge.setBadgeCount).toHaveBeenLastCalledWith(3));

    await act(async () => {
      captured.qc?.setQueryData(chatKeys.rooms("ws1"), [room("a", 0, 0), room("m", 5, 1, true)]);
    });
    await vi.waitFor(() => expect(bridge.setBadgeCount).toHaveBeenLastCalledWith(1));

    act(() => root.unmount());
    expect(bridge.setBadgeCount).toHaveBeenLastCalledWith(0);
  });
});

describe("useIsUniChatHost", () => {
  function Probe({ out }: { out: { value: boolean | null } }) {
    out.value = useIsUniChatHost();
    return null;
  }

  it("is true with the bridge and false without it", async () => {
    const out = { value: null as boolean | null };
    await act(async () => root.render(<Probe out={out} />));
    expect(out.value).toBe(true);

    const w = window as unknown as { desktopAPI?: unknown };
    const saved = w.desktopAPI;
    delete w.desktopAPI;
    try {
      act(() => root.unmount());
      root = createRoot(host);
      await act(async () => root.render(<Probe out={out} />));
      expect(out.value).toBe(false);
    } finally {
      w.desktopAPI = saved;
    }
  });
});
