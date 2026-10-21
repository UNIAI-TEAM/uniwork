// Ported from usf apps/mobile/lib/i18n/config.tsx: the device language picks
// the start locale, a Settings choice (data/device-preferences.ts) wins over it.
import * as Localization from "expo-localization";
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { readDevicePreference, writeDevicePreference } from "@/data/device-preferences";
import { bestEffort } from "@/data/report";
import { DEFAULT_LOCALE, i18n, matchSupportedLocale, type SupportedLocale } from "@/lib/i18n/singleton";

const SYSTEM_LOCALE = matchSupportedLocale(Localization.getLocales().map((locale) => locale.languageTag));
void i18n.changeLanguage(SYSTEM_LOCALE);

function isSupported(value: string | null): value is SupportedLocale {
  return value === "vi" || value === "en";
}

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => undefined });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(SYSTEM_LOCALE);

  useEffect(() => {
    let cancelled = false;
    readDevicePreference("locale")
      .then((saved) => {
        if (cancelled || !isSupported(saved)) return;
        setLocaleState(saved);
        void i18n.changeLanguage(saved);
      })
      // An unreadable preference leaves the device language in place.
      .catch(bestEffort("i18n", "saved language not read", "breadcrumb"));
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        void i18n.changeLanguage(next);
        void writeDevicePreference("locale", next).catch(bestEffort("i18n", "language not saved", "breadcrumb"));
      },
    }),
    [locale],
  );

  return (
    <LocaleContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}

export function useLocalePreference(): LocaleContextValue {
  return use(LocaleContext);
}
