import { DESKTOP_IDENTITY } from "../shared/identity";

export type NavigationDecision = { action: "allow" | "deny" | "external"; url: string };

const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:"]);

function isInternalDesktopUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === `${DESKTOP_IDENTITY.appScheme}:` || url.protocol === `${DESKTOP_IDENTITY.previewScheme}:` || url.protocol === `${DESKTOP_IDENTITY.assetScheme}:`;
  } catch {
    return false;
  }
}

export function isAllowedExternalUrl(value: string, allowedHosts: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) && allowedHosts.some((host) => url.hostname.toLowerCase() === host.toLowerCase());
  } catch {
    return false;
  }
}

export function decideNavigation(value: string, allowedExternalHosts: readonly string[] = []): NavigationDecision {
  if (isInternalDesktopUrl(value)) return { action: "allow", url: value };
  if (isAllowedExternalUrl(value, allowedExternalHosts)) return { action: "external", url: value };
  return { action: "deny", url: value };
}

export function installNavigationGuards(
  webContents: {
    on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): void;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" | "allow" }): void;
  },
  allowedExternalHosts: readonly string[],
  openSystemBrowser: (url: string) => void,
): void {
  webContents.on("will-navigate", (event, url) => {
    const decision = decideNavigation(url, allowedExternalHosts);
    if (decision.action === "allow") return;
    event.preventDefault();
    if (decision.action === "external") openSystemBrowser(decision.url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, allowedExternalHosts);
    if (decision.action === "external") openSystemBrowser(decision.url);
    return { action: "deny" };
  });
}
