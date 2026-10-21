import type { Page } from "@playwright/test";
import { e2eApiUrl } from "./api-url";

/**
 * UNI-1826: a fake `window.desktopAPI` (the DesktopBridge contract,
 * packages/core/platform/desktop-bridge.ts) stands in for the Electron
 * preload; its session provider is backed by the refresh cookie the browser
 * already holds, so the app initialises through the provider path for real.
 * The fake records what the shell would have done in `window.__uniChat`.
 */
interface UniChatProbe {
  badge: number[];
  external: string[];
  deepLink: ((url: string) => void) | null;
}

declare global {
  interface Window {
    __uniChat: UniChatProbe;
  }
}

/** Installs the fake bridge for every later navigation: the next full load boots the app as the UniChat host. */
export async function installUniChatBridge(page: Page): Promise<void> {
  await page.addInitScript((apiUrl: string) => {
    const token = () =>
      fetch(`${apiUrl}/api/v1/auth/refresh`, { method: "POST", credentials: "include" }).then((r) =>
        r.ok ? r.json().then((j: { access_token?: string }) => j.access_token ?? null) : null,
      );
    window.__uniChat = { badge: [], external: [], deepLink: null };
    (window as unknown as { desktopAPI: unknown }).desktopAPI = {
      app: "unichat",
      appInfo: { version: "e2e", os: "unknown" },
      session: {
        login: () => Promise.resolve(),
        getAccessToken: token,
        refresh: token,
        logout: () =>
          fetch(`${apiUrl}/api/v1/auth/logout`, { method: "POST", credentials: "include" }).then(() => undefined),
        onChange: () => () => {},
      },
      setBadgeCount: (n: number) => {
        window.__uniChat.badge.push(n);
      },
      isFocused: () => Promise.resolve(true),
      onFocusChange: () => () => {},
      focusWindow: () => {},
      openExternal: (u: string) => {
        window.__uniChat.external.push(u);
        return Promise.resolve();
      },
      downloadURL: () => Promise.resolve(),
      onDeepLink: (cb: (url: string) => void) => {
        window.__uniChat.deepLink = cb;
        return () => {};
      },
    };
  }, e2eApiUrl);
}
