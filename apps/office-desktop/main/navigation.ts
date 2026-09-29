import { DESKTOP_IDENTITY } from "../shared/identity";
import { isAllowedExternalUrl } from "../shared/external-url";

export type NavigationDecision = { action: "allow" | "deny" | "external"; url: string };

function isInternalDesktopUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // Preview and asset documents must use a separate, bridge-free webContents
    // and may never navigate the privileged application window.
    return url.protocol === `${DESKTOP_IDENTITY.appScheme}:`;
  } catch {
    return false;
  }
}

export { isAllowedExternalUrl } from "../shared/external-url";

export function openApprovedExternal(value: string, allowedHosts: readonly string[], openSystemBrowser: (url: string) => void): boolean {
  if (!isAllowedExternalUrl(value, allowedHosts)) return false;
  openSystemBrowser(value);
  return true;
}

export function decideNavigation(value: string, allowedExternalHosts: readonly string[] = []): NavigationDecision {
  if (isInternalDesktopUrl(value)) return { action: "allow", url: value };
  if (isAllowedExternalUrl(value, allowedExternalHosts)) return { action: "external", url: value };
  return { action: "deny", url: value };
}

export function installNavigationGuards(
  webContents: {
    on(event: "will-navigate" | "will-redirect" | "will-frame-navigate", listener: (event: { preventDefault(): void }, url: string, isMainFrame?: boolean) => void): void;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" | "allow" }): void;
  },
  allowedExternalHosts: readonly string[],
  openSystemBrowser: (url: string) => void,
): void {
  const handleNavigation = (event: { preventDefault(): void }, url: string): void => {
    const decision = decideNavigation(url, allowedExternalHosts);
    if (decision.action === "allow") return;
    event.preventDefault();
    if (decision.action === "external") openApprovedExternal(decision.url, allowedExternalHosts, openSystemBrowser);
  };
  webContents.on("will-navigate", handleNavigation);
  webContents.on("will-redirect", handleNavigation);
  webContents.on("will-frame-navigate", handleNavigation);
  webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, allowedExternalHosts);
    if (decision.action === "external") openApprovedExternal(decision.url, allowedExternalHosts, openSystemBrowser);
    return { action: "deny" };
  });
}
