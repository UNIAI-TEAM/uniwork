"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@uniwork/core";
import { useAuthStore } from "@uniwork/core/auth";
import { createBrowserCookieLocaleAdapter, type SupportedLocale } from "@uniwork/core/i18n";
import { syncRequestLocale } from "@uniwork/core/i18n/sync-request-locale";
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
    syncRequestLocale(initialLocale);
    return initialLocale;
  });
  useEffect(() => {
    document.documentElement.lang = applied;
  }, [applied]);

  return <LocaleAdapterProvider adapter={adapter}>{children}</LocaleAdapterProvider>;
}
