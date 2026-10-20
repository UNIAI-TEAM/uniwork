import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DesktopBridge, SessionProvider } from "../shared/bridge";

// The bridge is the whole point of contextIsolation; without it the page could reach this scope.
if (!process.contextIsolated) throw new Error("UniChat preload requires contextIsolation");

type AppInfo = DesktopBridge["appInfo"];

// Sync so the web app has version/os on its first render. The answer comes
// from our own main process (structured clone, not network JSON); main answers
// null to a foreign frame such as offline.html, where nobody reads it.
function readAppInfo(): AppInfo {
  const info = ipcRenderer.sendSync("app:info") as AppInfo | null;
  return info ?? { version: "unknown", os: "unknown" };
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Access tokens only: main keeps the refresh token and never has a channel that returns it.
const session: SessionProvider = {
  login: () => ipcRenderer.invoke("session:login"),
  getAccessToken: () => ipcRenderer.invoke("session:get-access-token"),
  refresh: () => ipcRenderer.invoke("session:refresh"),
  logout: () => ipcRenderer.invoke("session:logout"),
  onChange: (cb) => subscribe("session:changed", cb),
};

const api = {
  app: "unichat",
  appInfo: readAppInfo(),
  session,
  setBadgeCount: (count: number): void => void ipcRenderer.invoke("app:set-badge", count),
  isFocused: (): Promise<boolean> => ipcRenderer.invoke("app:is-focused"),
  onFocusChange: (cb: (focused: boolean) => void) => subscribe("app:focus-changed", cb),
  focusWindow: (): void => void ipcRenderer.invoke("app:focus-window"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:open-external", url),
  // shortcut: `name` is dropped — webContents.downloadURL cannot name the file; add a will-download handler when a caller needs it
  downloadURL: (url: string): Promise<void> => ipcRenderer.invoke("shell:download-url", url),
  openNotificationSettings: (): Promise<void> => ipcRenderer.invoke("shell:open-notification-settings"),
  onDeepLink: (cb: (url: string) => void) => {
    // Main holds deep links until the renderer's listener is mounted (link:ready handshake).
    const off = subscribe("link:deep-link", cb);
    void ipcRenderer.invoke("link:ready", true);
    return () => {
      off();
      void ipcRenderer.invoke("link:ready", false);
    };
  },
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld("desktopAPI", api);
