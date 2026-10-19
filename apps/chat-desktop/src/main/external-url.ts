import { shell, type BrowserWindow } from "electron";
import { describeBlockedNavigation } from "./navigation-guard";

export interface ExternalUrlOptions {
  /** `http:` to localhost / 127.0.0.1 / [::1] is allowed only when the shell runs in dev. */
  allowHttpLoopback: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Only `https:` (plus dev loopback `http:`) may reach the OS shell or the
// download system. The WHATWG parser lowercases the scheme, so casing cannot bypass it.
export function isSafeExternalUrl(url: string, opts: ExternalUrlOptions): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === "https:") return true;
    return protocol === "http:" && opts.allowHttpLoopback && LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

// Canonical wrapper around shell.openExternal; direct calls elsewhere in main
// are banned by no-restricted-syntax in eslint.config.mjs.
export async function openExternalSafely(url: string, opts: ExternalUrlOptions): Promise<void> {
  if (!isSafeExternalUrl(url, opts)) {
    console.warn(`[security] blocked openExternal: ${describeBlockedNavigation(url)}`);
    return;
  }
  await shell.openExternal(url);
}

// The OS page where a person turns this app's notifications on. Fixed per
// platform and never taken from the renderer, which is why it may bypass the
// https allowlist above; Linux has no such page.
const NOTIFICATION_SETTINGS_URLS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "x-apple.systempreferences:com.apple.preference.notifications",
  win32: "ms-settings:notifications",
};

export async function openNotificationSettings(platform: NodeJS.Platform = process.platform): Promise<void> {
  const url = NOTIFICATION_SETTINGS_URLS[platform];
  if (url) await shell.openExternal(url);
}

// Canonical wrapper around webContents.downloadURL, same allowlist as above.
export function downloadURLSafely(win: BrowserWindow, url: string, opts: ExternalUrlOptions): void {
  if (!isSafeExternalUrl(url, opts)) {
    console.warn(`[security] blocked downloadURL: ${describeBlockedNavigation(url)}`);
    return;
  }
  win.webContents.downloadURL(url);
}
