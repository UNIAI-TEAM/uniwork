import { leaveGuardAllows, type NavigationAdapter } from "@uniwork/views/navigation";

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
 * This module is plain TypeScript on purpose: apps/web compiles JSX itself
 * (tsconfig jsx: preserve), so host tests import the logic without a JSX
 * transform.
 */
export function createWebNavigationAdapter(
  router: WebNavigationRouter,
  pathname: string,
  searchParams: URLSearchParams,
): NavigationAdapter {
  const guarded = (move: () => void) => {
    void leaveGuardAllows(pathname).then((allowed) => {
      if (allowed) move();
    });
  };
  return {
    push: (path) => guarded(() => router.push(path)),
    replace: (path) => guarded(() => router.replace(path)),
    back: () => guarded(() => router.back()),
    forward: () => guarded(() => router.forward()),
    pathname,
    searchParams,
    getShareableUrl: (path) => (typeof window === "undefined" ? path : window.location.origin + path),
    // router.prefetch is a no-op in dev by Next's design; in production it
    // warms the RSC payload so the next push commits with no round-trip.
    prefetch: (path) => router.prefetch(path),
  };
}
