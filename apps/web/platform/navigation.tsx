"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NavigationProvider, type NavigationAdapter } from "@uniwork/views/navigation";

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
      push: (path) => router.push(path),
      replace: (path) => router.replace(path),
      back: () => router.back(),
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
