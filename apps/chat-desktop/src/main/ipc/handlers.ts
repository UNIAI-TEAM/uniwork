import { app, ipcMain, type BrowserWindow } from "electron";
import type { DesktopBridge } from "../../shared/bridge";
import type { ShellSession } from "../auth/session";
import { applyBadge } from "../badge";
import { DEEP_LINK_CHANNEL, type MainRendererQueue } from "../deep-link";
import { downloadURLSafely, openExternalSafely, openNotificationSettings } from "../external-url";
import type { ShellConfig } from "../runtime-config";
import { expectBoolean, expectCount, expectUrl, guard, isTrustedSender, sendToApp } from "./schema";

export interface IpcDeps {
  config: ShellConfig;
  session: Pick<ShellSession, "login" | "getAccessToken" | "refresh" | "logout">;
  queue: MainRendererQueue;
  /** null between a window closing and the next one (macOS keeps the app alive). */
  getWindow: () => BrowserWindow | null;
}

export function appInfo(version: string, platform: NodeJS.Platform): DesktopBridge["appInfo"] {
  const os = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : "unknown";
  return { version, os };
}

/** Deep links travel as app URLs so the web's parser accepts them in every env (its scheme check is prod-only). */
export function sendDeepLink(deps: Pick<IpcDeps, "config" | "queue" | "getWindow">, path: string): void {
  deps.queue.enqueue(DEEP_LINK_CHANNEL, `${deps.config.appUrl}${path}`, (channel, payload) =>
    sendToApp(deps.getWindow(), deps.config.appUrl, channel, payload),
  );
}

const nothing = (): undefined => undefined;

/** The closed IPC surface (spec §3.3); every channel runs through `guard` and the app origin. */
export function registerIpc(deps: IpcDeps): void {
  const { config, session, queue, getWindow } = deps;
  const origin = config.appUrl;
  const external = { allowHttpLoopback: config.env === "dev" };
  const send = (channel: typeof DEEP_LINK_CHANNEL, payload: unknown) => sendToApp(getWindow(), origin, channel, payload);

  // Sync so the renderer has appInfo before its first render; a foreign frame gets null.
  ipcMain.on("app:info", (event) => {
    event.returnValue = isTrustedSender(event, origin) ? appInfo(app.getVersion(), process.platform) : null;
  });

  ipcMain.handle("session:login", guard(origin, nothing, () => session.login()));
  ipcMain.handle("session:get-access-token", guard(origin, nothing, () => session.getAccessToken()));
  ipcMain.handle("session:refresh", guard(origin, nothing, () => session.refresh()));
  ipcMain.handle("session:logout", guard(origin, nothing, () => session.logout()));

  ipcMain.handle("app:set-badge", guard(origin, expectCount, (count) => applyBadge(count, getWindow())));
  ipcMain.handle("app:is-focused", guard(origin, nothing, () => getWindow()?.isFocused() ?? false));
  ipcMain.handle(
    "app:focus-window",
    guard(origin, nothing, () => {
      const win = getWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }),
  );

  ipcMain.handle("shell:open-external", guard(origin, expectUrl, (url) => openExternalSafely(url, external)));
  ipcMain.handle(
    "shell:download-url",
    guard(origin, expectUrl, (url) => {
      const win = getWindow();
      if (win) downloadURLSafely(win, url, external);
    }),
  );
  ipcMain.handle("shell:open-notification-settings", guard(origin, nothing, () => openNotificationSettings()));

  ipcMain.handle("link:ready", guard(origin, expectBoolean, (ready) => queue.setReady(DEEP_LINK_CHANNEL, ready, send)));
}
