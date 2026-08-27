"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  createBrowserCookieLocaleAdapter,
  initI18n,
  pickLocale,
} from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";

/** Cookie-backed locale adapter for the web host; syncs i18n on boot. */
export function WebLocaleProvider({ children }: { children: ReactNode }) {
  const [adapter] = useState(createBrowserCookieLocaleAdapter);

  useEffect(() => {
    const locale = pickLocale(adapter);
    void initI18n().changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [adapter]);

  return (
    <LocaleAdapterProvider adapter={adapter}>{children}</LocaleAdapterProvider>
  );
}
