"use client";

import { Suspense, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import { registerSystemNotificationClickHandler } from "@uniwork/core/platform";
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

  // A clicked browser banner opens what it was about, through the same
  // guarded push as any in-app move; anything but a same-origin path is ignored.
  useEffect(() => {
    registerSystemNotificationClickHandler((payload) => {
      const to = sanitizeNextUrl(payload.href);
      if (to) adapter.push(to);
    });
    return () => registerSystemNotificationClickHandler(null);
  }, [adapter]);

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
