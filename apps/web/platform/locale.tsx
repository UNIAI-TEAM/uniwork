"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@uniwork/core";
import { useAuthStore } from "@uniwork/core/auth";
import { createBrowserCookieLocaleAdapter, initI18n, setLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";

/**
 * Cookie-backed locale adapter for the web host. `initialLocale` comes from
 * the server (resolveRequestLocale) and is applied during render on both
 * sides, so server HTML and the first client render agree; switching later
 * (the settings page) goes through the adapter and i18n.changeLanguage.
 */
export function WebLocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: SupportedLocale;
  children: ReactNode;
}) {
  const [adapter] = useState(() => {
    const base = createBrowserCookieLocaleAdapter();
    return {
      ...base,
      persist(locale: SupportedLocale) {
        base.persist(locale);
        // Mail follows the user's language; a failed sync only affects the
        // next mail's language, so it is fire-and-forget.
        if (useAuthStore.getState().user) void api.auth.patchMe({ locale }).catch(() => {});
      },
    };
  });
  const [applied] = useState(() => {
    const i18n = initI18n();
    // Only Vietnamese ships in the initial bundle; any other locale is fetched
    // here, one tick after the first paint. Nothing is translated on the
    // server, so that tick cannot produce a hydration mismatch.
    if (i18n.language !== initialLocale) void setLocale(initialLocale);
    return initialLocale;
  });
  useEffect(() => {
    document.documentElement.lang = applied;
  }, [applied]);

  return <LocaleAdapterProvider adapter={adapter}>{children}</LocaleAdapterProvider>;
}
