import { hasAppOrigin } from "./ipc/schema";

/**
 * Web permissions the shell grants. Electron routes navigator.clipboard.writeText
 * and element.requestFullscreen through the handler too, so copy-message and
 * fullscreen inside the shell need their entries.
 */
export const PERMISSIONS_ALLOWED: ReadonlySet<string> = new Set([
  "media",
  "display-capture",
  "notifications",
  "clipboard-sanitized-write",
  "fullscreen",
]);

/** Only the app document itself (main frame on the app origin) gets an allowlisted permission. */
export function decidePermission(
  permission: string,
  requestingUrl: string,
  isMainFrame: boolean,
  appOrigin: string,
): boolean {
  return isMainFrame && hasAppOrigin(requestingUrl, appOrigin) && PERMISSIONS_ALLOWED.has(permission);
}
