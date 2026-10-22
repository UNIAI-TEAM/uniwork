// Ported from usf apps/mobile/lib/i18n/config.tsx: the device language picks
// the start locale, a Settings choice (data/device-preferences.ts) wins over it
// until the system's own language setting changes after it
// (data/locale-preference.ts). The saved choice is read once per launch, from
// boot (app/_layout.tsx › loadLocalePreference), and the splash waits for the
// read (useLocaleReady), so the first frame is already in the right language.
// The device's 12/24-hour clock reaches every date formatter
// (lib/locale-format.ts) at start and each time the app comes back, and the
// system language is asked again then too: Android 13+ app languages change
// it while the JS runtime lives on.
import * as Localization from "expo-localization";
import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { AppState } from "react-native";
import { useStore } from "zustand";
import { readDevicePreference, writeDevicePreference } from "@/data/device-preferences";
import { createLocalePreference } from "@/data/locale-preference";
import { DEFAULT_LOCALE, i18n, matchSupportedLocale, type SupportedLocale } from "@/lib/i18n/singleton";
import { setDeviceClock } from "@/lib/locale-format";

/** The phone's language now (read each time: Android's per-app language can change while the app runs). */
function systemLocale(): SupportedLocale {
  return matchSupportedLocale(Localization.getLocales().map((locale) => locale.languageTag));
}
void i18n.changeLanguage(systemLocale());

/** The phone's clock setting, for the formatters; unknown (no calendar) keeps each language's default. */
function syncDeviceClock(): void {
  setDeviceClock(Localization.getCalendars()[0]?.uses24hourClock);
}
syncDeviceClock();

const preference = createLocalePreference({
  system: systemLocale,
  read: () => readDevicePreference("locale"),
  write: (value) => writeDevicePreference("locale", value),
  apply: (locale) => void i18n.changeLanguage(locale),
});

/** Boot: the saved choice, once. */
export const loadLocalePreference = preference.load;

/** True once the saved choice has been read (or could not be): the splash waits for it. */
export function useLocaleReady(): boolean {
  return useStore(preference.store, (s) => s.ready);
}

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => undefined });

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useStore(preference.store, (s) => s.locale);

  useEffect(() => {
    // Boot already asked; this is the same read, for a provider mounted without that boot (tests, a remount).
    void preference.load();
    // The 12/24-hour switch and the per-app language can change while UniChat sits in the background.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      syncDeviceClock();
      preference.refresh();
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale: preference.set }), [locale]);

  return (
    <LocaleContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}

export function useLocalePreference(): LocaleContextValue {
  return use(LocaleContext);
}
