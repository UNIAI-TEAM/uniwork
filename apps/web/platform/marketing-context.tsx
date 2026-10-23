"use client";
import { createContext, useContext, useEffect } from "react";
import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { I18nProvider } from "@uniwork/core/i18n/react";

const MarketingLocale = createContext<SupportedLocale>("en");
export const useMarketingLocale = () => useContext(MarketingLocale);

export function persistMarketingLocale(locale: SupportedLocale): void {
  document.cookie = `uniwork-locale=${locale};path=/;max-age=31536000;SameSite=Lax${location.protocol === "https:" ? ";Secure" : ""}`;
}

export function MarketingCopyProvider({ locale, dictionary, children }: { locale: SupportedLocale; dictionary: Record<string, unknown>; children: React.ReactNode }) {
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <MarketingLocale.Provider value={locale}><I18nProvider key={locale} locale={locale} resources={{ [locale]: { translation: dictionary } }}>{children}</I18nProvider></MarketingLocale.Provider>;
}
