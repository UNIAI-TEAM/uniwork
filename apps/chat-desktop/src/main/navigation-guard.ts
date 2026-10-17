/**
 * Top-level navigation hardening for the shell window. Client-side routing
 * never fires `will-navigate`, so in-app paths are the web app's concern; this
 * catches a real document-level navigation away from the trusted origins
 * (`window.location = 'https://evil.example'`, a dropped file URL, javascript:).
 * New windows go through `setWindowOpenHandler` → `openExternalSafely`.
 */

/** The subset of BrowserWindow this module needs — keeps it unit-testable. */
export type NavigationGuardWindow = {
  webContents: {
    on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): unknown;
  };
};

/** True when `url` is an http(s) document on one of the trusted origins (app, api). */
export function isTrustedNavigation(url: string, trustedOrigins: readonly string[]): boolean {
  try {
    const { protocol, origin } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && trustedOrigins.includes(origin);
  } catch {
    return false;
  }
}

/** Origin only, never the path: a blocked URL is attacker-controlled. */
export function describeBlockedNavigation(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return host ? `${protocol}//${host}` : protocol;
  } catch {
    return "invalid URL";
  }
}

/** Install the guard. Call before loading the window so the first load is covered. */
export function installNavigationGuard(window: NavigationGuardWindow, trustedOrigins: readonly string[]): void {
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedNavigation(url, trustedOrigins)) return;
    event.preventDefault();
    console.warn(`[security] blocked will-navigate to an untrusted origin: ${describeBlockedNavigation(url)}`);
  });
}
