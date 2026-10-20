// Ported from usf apps/mobile/lib/i18n/config.tsx: the device language picks
// the start locale, a Settings choice persisted in SecureStore wins over it.
import * as Localization from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { DEFAULT_LOCALE, i18n, matchSupportedLocale, type SupportedLocale } from "./singleton";

const LOCALE_KEY = "locale_preference";

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
    SecureStore.getItemAsync(LOCALE_KEY)
      .then((saved) => {
        if (cancelled || !isSupported(saved)) return;
        setLocaleState(saved);
        void i18n.changeLanguage(saved);
      })
      .catch(() => {
        // An unreadable preference leaves the device language in place.
      });
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
        void SecureStore.setItemAsync(LOCALE_KEY, next).catch(() => undefined);
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
