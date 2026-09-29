"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@uniwork/core";
import { useAuthStore } from "@uniwork/core/auth";
import { createBrowserCookieLocaleAdapter, initI18n, syncI18nResources, type SupportedLocale } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import { syncRequestLocale } from "@uniwork/core/i18n/sync-request-locale";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";

/**
 * Cookie-backed locale adapter for the web host. `initialLocale` comes from
 * the server (resolveRequestLocale) and is applied during render on both
 * sides, so server HTML and the first client render agree; switching later
 * (the settings page) goes through the adapter and i18n.changeLanguage.
 *
 * `initialDictionary` is the Vietnamese resource bag when the request locale is
 * `vi` — loaded only on the server so `vi.json` stays out of the shared
 * client chunk (see sync-request-locale.ts).
 */
export function WebLocaleProvider({
  initialLocale,
  initialDictionary,
  children,
}: {
  initialLocale: SupportedLocale;
  initialDictionary?: object;
  children: ReactNode;
}) {
  const englishDictionary = en;
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
    syncRequestLocale(initialLocale, initialDictionary);
    return initialLocale;
  });

  // The mount initializer survives Fast Refresh. New JSON and request bundles
  // must also update the live store and notify already mounted translations.
  useEffect(() => {
    syncI18nResources(initI18n(), {
      en: englishDictionary,
      vi: initialLocale === "vi" ? initialDictionary ?? null : null,
    });
  }, [englishDictionary, initialDictionary, initialLocale]);

  useEffect(() => {
    document.documentElement.lang = applied;
  }, [applied]);

  return <LocaleAdapterProvider adapter={adapter}>{children}</LocaleAdapterProvider>;
}
