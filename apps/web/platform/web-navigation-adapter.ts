import { runtimeConfig } from "@uniwork/core/runtime-config";
import { leaveGuardAllows, type NavigationAdapter } from "@uniwork/views/navigation";
import type { HostNavigationPolicy } from "./chat-only-navigation";

/** The slice of the Next router the adapter needs. */
export interface WebNavigationRouter {
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  forward(): void;
  prefetch(path: string): void;
}

/**
 * Build the web navigation adapter: every in-app move — push, replace, back
 * and forward — asks the leave guards first, so a screen that owns unsaved
 * work is never left silently. Exported for the host test; the provider in
 * ./navigation is its only production caller.
 *
 * Browser chrome Back is a popstate the App Router handles itself and
 * beforeunload does not fire for a same-document history move, so that one
 * path stays best-effort (documented in the lane report).
 *
 * A `host` policy (the UniChat shell) decides where each push/replace goes:
 * the resolved in-shell path, or the browser when it answers null.
 *
 * This module is plain TypeScript on purpose: apps/web compiles JSX itself
 * (tsconfig jsx: preserve), so host tests import the logic without a JSX
 * transform.
 */
export function createWebNavigationAdapter(
  router: WebNavigationRouter,
  pathname: string,
  searchParams: URLSearchParams,
  host?: HostNavigationPolicy,
): NavigationAdapter {
  const guarded = (move: () => void) => {
    void leaveGuardAllows(pathname).then((allowed) => {
      if (allowed) move();
    });
  };
  const route = (path: string, move: (target: string) => void) => {
    const target = host ? host.resolve(path) : path;
    if (target === null) host?.openExternal(runtimeConfig().appUrl + path);
    else guarded(() => move(target));
  };
  return {
    push: (path) => route(path, (target) => router.push(target)),
    replace: (path) => route(path, (target) => router.replace(target)),
    back: () => guarded(() => router.back()),
    forward: () => guarded(() => router.forward()),
    pathname,
    searchParams,
    openExternal: host?.openExternal ?? ((url) => window.location.assign(url)),
    getShareableUrl: (path) => (typeof window === "undefined" ? path : window.location.origin + path),
    // router.prefetch is a no-op in dev by Next's design; in production it
    // warms the RSC payload so the next push commits with no round-trip.
    prefetch: (path) => router.prefetch(path),
  };
}
