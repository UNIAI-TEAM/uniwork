"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  leaveGuardAllows,
  NavigationProvider,
  type NavigationAdapter,
} from "@uniwork/views/navigation";

/**
 * The web half of the navigation adapter: the only place shared screens'
 * navigation touches next/navigation. Everything under packages/views goes
 * through useNavigation() / <AppLink> and never learns which router it is on.
 */
function NavigationProviderInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const adapter = useMemo<NavigationAdapter>(
    () => ({
      // A screen that owns unsaved work can hold a navigation: the guard asks
      // the user (save / wait / discard) before the route commits, and refuses
      // the push when they choose to stay. Only the web host can do this,
      // which is why the registry lives in views and the wait lives here.
      push: (path) => {
        void leaveGuardAllows(path).then((allowed) => {
          if (allowed) router.push(path);
        });
      },
      replace: (path) => {
        void leaveGuardAllows(path).then((allowed) => {
          if (allowed) router.replace(path);
        });
      },
      // back/forward are guarded too: a screen with unsaved work is left by
      // the same dialog, not only by a push. Browser chrome Back is a
      // popstate the App Router handles itself and beforeunload does not fire
      // for a same-document history move, so that one path stays best-effort
      // (documented in the lane report).
      back: () => {
        void leaveGuardAllows(pathname).then((allowed) => {
          if (allowed) router.back();
        });
      },
      forward: () => {
        void leaveGuardAllows(pathname).then((allowed) => {
          if (allowed) router.forward();
        });
      },
      pathname,
      searchParams: new URLSearchParams(searchParams.toString()),
      getShareableUrl: (path) => (typeof window === "undefined" ? path : window.location.origin + path),
      // router.prefetch is a no-op in dev by Next's design; in production it
      // warms the RSC payload so the next push commits with no round-trip.
      prefetch: (path) => router.prefetch(path),
    }),
    [router, pathname, searchParams],
  );

  return <NavigationProvider value={adapter}>{children}</NavigationProvider>;
}

export function WebNavigationProvider({ children }: { children: React.ReactNode }) {
  // useSearchParams needs a Suspense boundary during static rendering.
  return (
    <Suspense>
      <NavigationProviderInner>{children}</NavigationProviderInner>
    </Suspense>
  );
}
