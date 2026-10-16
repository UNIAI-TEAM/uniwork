import { isGlobalPath, sanitizeNextUrl } from "@uniwork/core/paths";
import type { DesktopBridge } from "@uniwork/core/platform";

/** How a host narrows in-app navigation: null from `resolve` means "leave the shell". */
export interface HostNavigationPolicy {
  resolve(path: string): string | null;
  openExternal(url: string): void;
}

const CHAT = /^\/[^/]+\/[^/]+\/chat(\/.*)?$/;
const LANDING = /^\/[^/]+\/[^/]+(\/tasks)?$/;

/**
 * In-shell target for a path, or null when the shell must hand it to the
 * browser. Global routes (login, auth, invite, workspaces, …) and
 * `/{org}/{ws}/chat*` stay; the post-login landing pages `/{org}/{ws}` and
 * `/{org}/{ws}/tasks` are rewritten to the chat screen, since every redirect
 * after sign-in or a workspace switch lands on `.tasks()`.
 */
export function resolveChatOnlyPath(path: string): string | null {
  const pathname = path.split("?")[0] ?? path;
  if (isGlobalPath(pathname) || CHAT.test(pathname)) return path;
  const landing = LANDING.exec(pathname);
  if (!landing) return null;
  return pathname.slice(0, pathname.length - (landing[1]?.length ?? 0)) + "/chat";
}

/**
 * The in-app path a deep link opens: `uniworkchat://open?url=<path>` or an
 * https URL of this app. Anything else, including another origin or a
 * protocol-relative path, is dropped.
 */
export function parseDeepLink(url: string, appUrl: string): string | null {
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return null;
  }
  if (link.protocol === "uniworkchat:") {
    return link.host === "open" ? sanitizeNextUrl(link.searchParams.get("url")) : null;
  }
  return link.origin === new URL(appUrl).origin ? sanitizeNextUrl(link.pathname + link.search) : null;
}

export function chatOnlyPolicy(bridge: DesktopBridge): HostNavigationPolicy {
  return {
    resolve: resolveChatOnlyPath,
    openExternal: (url) => void bridge.openExternal(url),
  };
}
