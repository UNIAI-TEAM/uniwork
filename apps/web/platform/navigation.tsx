"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NavigationProvider } from "@uniwork/views/navigation";
import { createWebNavigationAdapter } from "./web-navigation-adapter";

/**
 * The web half of the navigation adapter: the only place shared screens'
 * navigation touches next/navigation. Everything under packages/views goes
 * through useNavigation() / <AppLink> and never learns which router it is on.
 */
function NavigationProviderInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const adapter = useMemo(
    () =>
      createWebNavigationAdapter(router, pathname, new URLSearchParams(searchParams.toString())),
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
