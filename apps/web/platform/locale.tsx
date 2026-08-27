"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createBrowserCookieLocaleAdapter, initI18n, type SupportedLocale } from "@uniwork/core/i18n";
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
  const [adapter] = useState(createBrowserCookieLocaleAdapter);
  const [applied] = useState(() => {
    const i18n = initI18n();
    if (i18n.language !== initialLocale) void i18n.changeLanguage(initialLocale);
    return initialLocale;
  });
  useEffect(() => {
    document.documentElement.lang = applied;
  }, [applied]);

  return <LocaleAdapterProvider adapter={adapter}>{children}</LocaleAdapterProvider>;
}
