import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "1.2.3", setBadgeCount: vi.fn(() => true) },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn(() => ({})) },
  shell: { openExternal: vi.fn(() => Promise.resolve()) },
}));

import { app, ipcMain, shell, type BrowserWindow } from "electron";
import { shellConfig } from "../auth/fakes";
import { DEEP_LINK_CHANNEL, MainRendererQueue } from "../deep-link";
import { appInfo, registerIpc, sendDeepLink, type IpcDeps } from "./handlers";

type Listener = (event: unknown, payload?: unknown) => Promise<unknown>;
type SyncListener = (event: { senderFrame: unknown; returnValue?: unknown }) => void;

const TRUSTED = { senderFrame: { url: `${shellConfig.appUrl}/chat/room` } };
const FOREIGN = { senderFrame: { url: "https://evil.example/chat" } };

function fakeWindow(documentUrl = `${shellConfig.appUrl}/chat`) {
  return {
    isDestroyed: () => false,
    isFocused: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { mainFrame: { url: documentUrl }, send: vi.fn(), downloadURL: vi.fn() },
  };
}

function setup(win: ReturnType<typeof fakeWindow> | null = fakeWindow()) {
  const session = {
    login: vi.fn(() => Promise.resolve()),
    getAccessToken: vi.fn(() => Promise.resolve("access-1")),
    refresh: vi.fn(() => Promise.resolve("access-2")),
    logout: vi.fn(() => Promise.resolve()),
  };
  const deps: IpcDeps = {
    config: shellConfig,
    session,
    queue: new MainRendererQueue(),
    getWindow: () => win as unknown as BrowserWindow | null,
  };
  registerIpc(deps);
  const handlers = new Map<string, Listener>(vi.mocked(ipcMain.handle).mock.calls.map(([c, l]) => [c, l as Listener]));
  const sync = new Map<string, SyncListener>(vi.mocked(ipcMain.on).mock.calls.map(([c, l]) => [c, l as SyncListener]));
  const invoke = (channel: string, payload?: unknown, event: unknown = TRUSTED) => handlers.get(channel)!(event, payload);
  return { deps, session, win, handlers, sync, invoke };
}

beforeEach(() => vi.clearAllMocks());

describe("registerIpc", () => {
  it("registers exactly the closed channel set of spec §3.3", () => {
    const { handlers, sync } = setup();
    expect([...handlers.keys()].sort()).toEqual(
      [
        "app:focus-window",
        "app:is-focused",
        "app:set-badge",
        "link:ready",
        "session:get-access-token",
        "session:login",
        "session:logout",
        "session:refresh",
        "shell:download-url",
        "shell:open-external",
        "shell:open-notification-settings",
      ].sort(),
    );
    expect([...sync.keys()]).toEqual(["app:info"]);
  });

  it("refuses every channel to a frame outside the app origin", async () => {
    const { handlers, session, invoke } = setup();
    for (const channel of handlers.keys()) {
      await expect(invoke(channel, undefined, FOREIGN)).rejects.toThrow("ipc rejected: untrusted_sender");
    }
    expect(session.login).not.toHaveBeenCalled();
    expect(app.setBadgeCount).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("hands session calls to the shell session and returns access tokens only", async () => {
    const { session, invoke } = setup();
    await invoke("session:login");
    expect(session.login).toHaveBeenCalledOnce();
    await expect(invoke("session:get-access-token")).resolves.toBe("access-1");
    await expect(invoke("session:refresh")).resolves.toBe("access-2");
    await invoke("session:logout");
    expect(session.logout).toHaveBeenCalledOnce();
  });

  it("clamps the badge and rejects a non-count", async () => {
    const { invoke } = setup();
    await invoke("app:set-badge", 4);
    expect(app.setBadgeCount).toHaveBeenCalledWith(4);
    await invoke("app:set-badge", 10_000);
    expect(app.setBadgeCount).toHaveBeenLastCalledWith(999);
    await expect(invoke("app:set-badge", "4")).rejects.toThrow("ipc rejected: not_count");
  });

  it("answers focus questions for the current window, false without one", async () => {
    const { win, invoke } = setup();
    await expect(invoke("app:is-focused")).resolves.toBe(true);
    win!.isFocused.mockReturnValue(false);
    await expect(invoke("app:is-focused")).resolves.toBe(false);
    await expect(setup(null).invoke("app:is-focused")).resolves.toBe(false);
  });

  it("restores, shows and focuses the window", async () => {
    const { win, invoke } = setup();
    await invoke("app:focus-window");
    expect(win!.restore).not.toHaveBeenCalled();
    expect(win!.show).toHaveBeenCalledOnce();
    expect(win!.focus).toHaveBeenCalledOnce();
    win!.isMinimized.mockReturnValue(true);
    await invoke("app:focus-window");
    expect(win!.restore).toHaveBeenCalledOnce();
    await expect(setup(null).invoke("app:focus-window")).resolves.toBeUndefined();
  });

  it("opens only safe external URLs", async () => {
    const { invoke } = setup();
    await invoke("shell:open-external", "https://docs.example/page");
    expect(shell.openExternal).toHaveBeenCalledWith("https://docs.example/page");
    await invoke("shell:open-external", "javascript:alert(1)");
    expect(shell.openExternal).toHaveBeenCalledOnce();
    await expect(invoke("shell:open-external", "not a url")).rejects.toThrow("ipc rejected: not_url");
  });

  it("downloads through the window, nothing without one", async () => {
    const { win, invoke } = setup();
    await invoke("shell:download-url", "https://files.example/a.pdf");
    expect(win!.webContents.downloadURL).toHaveBeenCalledWith("https://files.example/a.pdf");
    await expect(setup(null).invoke("shell:download-url", "https://files.example/a.pdf")).resolves.toBeUndefined();
  });

  it("holds deep links until the renderer reports link:ready, then sends app URLs", async () => {
    const { deps, win, invoke } = setup();
    sendDeepLink(deps, "/chat/room-1");
    expect(win!.webContents.send).not.toHaveBeenCalled();
    await invoke("link:ready", true);
    expect(win!.webContents.send).toHaveBeenCalledWith(DEEP_LINK_CHANNEL, `${shellConfig.appUrl}/chat/room-1`);
    sendDeepLink(deps, "/chat/room-2");
    expect(win!.webContents.send).toHaveBeenCalledTimes(2);
    await invoke("link:ready", false);
    sendDeepLink(deps, "/chat/room-3");
    expect(win!.webContents.send).toHaveBeenCalledTimes(2);
    await expect(invoke("link:ready", "yes")).rejects.toThrow("ipc rejected: not_boolean");
  });

  it("never pushes a deep link into a foreign or offline document", async () => {
    for (const url of ["https://evil.example/chat", "file:///offline.html"]) {
      const { deps, win, invoke } = setup(fakeWindow(url));
      await invoke("link:ready", true);
      sendDeepLink(deps, "/chat/room");
      expect(win!.webContents.send).not.toHaveBeenCalled();
    }
  });

  it("drops a ready deep link when the window is gone instead of throwing", async () => {
    const { deps, invoke } = setup(null);
    await invoke("link:ready", true);
    expect(() => sendDeepLink(deps, "/chat/room")).not.toThrow();
  });

  it("answers app:info synchronously to the app frame only", () => {
    const { sync } = setup();
    const trusted = { ...TRUSTED, returnValue: undefined as unknown };
    sync.get("app:info")!(trusted);
    expect(trusted.returnValue).toEqual({ version: "1.2.3", os: appInfo("1.2.3", process.platform).os });
    const foreign = { ...FOREIGN, returnValue: undefined as unknown };
    sync.get("app:info")!(foreign);
    expect(foreign.returnValue).toBeNull();
  });
});

describe("appInfo", () => {
  it("maps the platform onto the bridge's os names", () => {
    expect(appInfo("1", "darwin")).toEqual({ version: "1", os: "macos" });
    expect(appInfo("1", "win32").os).toBe("windows");
    expect(appInfo("1", "linux").os).toBe("linux");
    expect(appInfo("1", "freebsd").os).toBe("unknown");
  });
});
