"use client";

import { useEffect, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { api } from "@uniwork/core";
import { useAuthStore } from "@uniwork/core/auth";
import {
  bundledDictionary,
  createBrowserCookieLocaleAdapter,
  initI18n,
  type SupportedLocale,
} from "@uniwork/core/i18n";
import { createI18n, LocaleAdapterProvider } from "@uniwork/core/i18n/react";

/**
 * Cookie-backed locale adapter for the web host, plus the i18next instance the
 * tree renders from.
 *
 * Two different instances on purpose, and the difference is the whole point of
 * this file. The browser has one visitor and keeps the shared instance, so the
 * language menus can switch it and every subscriber re-renders. The server has
 * every visitor at once and gets a fresh instance per render: i18next is a
 * module singleton, `changeLanguage` is async, and the earlier arrangement
 * fired it without awaiting during render. The switch landed after that render
 * and applied to the NEXT one, so each request was served the previous
 * visitor's language while `<html lang>` said otherwise — Vietnamese copy under
 * `lang="en"`, which is a WCAG 3.1.1 failure as well as a wrong page. Six
 * alternating requests reproduced it every time.
 *
 * Both branches render the same locale from the same dictionary, so the markup
 * is identical and hydration has nothing to reconcile.
 */
export function WebLocaleProvider({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: SupportedLocale;
  /**
   * The dictionary for a locale that is not in the JS bundle, read on the
   * server. Null when the bundle already carries it — see `loadDictionary`.
   */
  initialMessages: Record<string, unknown> | null;
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

  const [instance] = useState(() => {
    const dictionary = bundledDictionary(initialLocale) ?? initialMessages;
    return typeof window === "undefined"
      ? createI18n(initialLocale, dictionary ? { [initialLocale]: { translation: dictionary } } : {})
      : initI18n(initialLocale, initialMessages);
  });

  useEffect(() => {
    document.documentElement.lang = initialLocale;
  }, [initialLocale]);

  return (
    <I18nextProvider i18n={instance}>
      <LocaleAdapterProvider adapter={adapter}>{children}</LocaleAdapterProvider>
    </I18nextProvider>
  );
}
