import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../shared/bridge";

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    sendSync: vi.fn((_channel: string): unknown => ({ version: "1.2.3", os: "macos" })),
    invoke: vi.fn((_channel: string, ..._args: unknown[]): Promise<unknown> => Promise.resolve("r")),
    on: vi.fn((_channel: string, _handler: unknown): void => undefined),
    removeListener: vi.fn((_channel: string, _handler: unknown): void => undefined),
  },
}));
vi.mock("electron", () => electron);

type Handler = (event: unknown, payload: unknown) => void;

async function loadPreload(contextIsolated = true): Promise<DesktopBridge> {
  vi.resetModules();
  vi.clearAllMocks();
  Object.defineProperty(process, "contextIsolated", { value: contextIsolated, configurable: true });
  await import("./index");
  const [name, api] = electron.contextBridge.exposeInMainWorld.mock.calls[0] as [string, DesktopBridge];
  expect(name).toBe("desktopAPI");
  return api;
}

const handlerFor = (channel: string): Handler =>
  electron.ipcRenderer.on.mock.calls.find(([c]) => c === channel)![1] as Handler;

beforeEach(() => vi.clearAllMocks());

describe("preload desktopAPI", () => {
  it("exposes exactly the DesktopBridge surface and nothing from electron", async () => {
    const api = await loadPreload();
    expect(Object.keys(api).sort()).toEqual(
      ["app", "appInfo", "session", "setBadgeCount", "isFocused", "onFocusChange", "focusWindow", "openExternal", "downloadURL", "openNotificationSettings", "onDeepLink"].sort(),
    );
    expect(Object.keys(api.session).sort()).toEqual(["login", "getAccessToken", "refresh", "logout", "onChange"].sort());
    expect(api.app).toBe("unichat");
    const allKeys = [...Object.keys(api), ...Object.keys(api.session)];
    expect(allKeys.some((k) => /refresh.?token/i.test(k))).toBe(false);
    expect(Object.values(api)).not.toContain(electron.ipcRenderer);
  });

  it("refuses to run without contextIsolation", async () => {
    await expect(loadPreload(false)).rejects.toThrow(/contextIsolation/);
  });

  it("reads appInfo synchronously and falls back when main refuses", async () => {
    expect((await loadPreload()).appInfo).toEqual({ version: "1.2.3", os: "macos" });
    expect(electron.ipcRenderer.sendSync).toHaveBeenCalledWith("app:info");
    electron.ipcRenderer.sendSync.mockReturnValue(null);
    expect((await loadPreload()).appInfo).toEqual({ version: "unknown", os: "unknown" });
    electron.ipcRenderer.sendSync.mockReturnValue({ version: "1.2.3", os: "macos" });
  });

  it("maps session calls onto the session:* channels", async () => {
    const api = await loadPreload();
    await api.session.login();
    electron.ipcRenderer.invoke.mockResolvedValueOnce("tok");
    await expect(api.session.getAccessToken()).resolves.toBe("tok");
    await api.session.refresh();
    await api.session.logout();
    expect(electron.ipcRenderer.invoke.mock.calls.map(([c]) => c)).toEqual([
      "session:login",
      "session:get-access-token",
      "session:refresh",
      "session:logout",
    ]);
  });

  it("maps app and shell calls, dropping the download name", async () => {
    const api = await loadPreload();
    api.setBadgeCount(3);
    await api.isFocused();
    api.focusWindow();
    await api.openExternal("https://x.example/");
    await api.downloadURL("https://x.example/f.pdf", "f.pdf");
    await api.openNotificationSettings?.();
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
      ["app:set-badge", 3],
      ["app:is-focused"],
      ["app:focus-window"],
      ["shell:open-external", "https://x.example/"],
      ["shell:download-url", "https://x.example/f.pdf"],
      ["shell:open-notification-settings"],
    ]);
  });

  it("subscribes to session:changed and app:focus-changed with matching unsubscribe", async () => {
    const api = await loadPreload();
    const onToken = vi.fn();
    const offToken = api.session.onChange(onToken);
    handlerFor("session:changed")({}, null);
    expect(onToken).toHaveBeenCalledWith(null);
    offToken();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith("session:changed", handlerFor("session:changed"));

    const onFocus = vi.fn();
    const offFocus = api.onFocusChange(onFocus);
    handlerFor("app:focus-changed")({}, false);
    expect(onFocus).toHaveBeenCalledWith(false);
    offFocus();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith("app:focus-changed", handlerFor("app:focus-changed"));
  });

  it("reports link:ready around the deep-link subscription", async () => {
    const api = await loadPreload();
    const cb = vi.fn();
    const off = api.onDeepLink(cb);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("link:ready", true);
    handlerFor("link:deep-link")({}, "https://x.example/chat/r");
    expect(cb).toHaveBeenCalledWith("https://x.example/chat/r");
    off();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith("link:deep-link", handlerFor("link:deep-link"));
    expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith("link:ready", false);
  });
});
