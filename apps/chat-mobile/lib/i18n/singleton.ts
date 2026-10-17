// Ported from usf apps/mobile/lib/i18n/{singleton,types}.ts. One i18next
// instance over the bundles scripts/sync-i18n.mjs generates; nested keys as
// on the web (`auth.desktop.unichat_login_title`). Free of React Native so
// Node tests and pure helpers share it; the provider applies the device
// language once native modules exist.
import { createInstance, type i18n as I18nInstance } from "i18next";
import en from "@/locales/en.json";
import vi from "@/locales/vi.json";

export type SupportedLocale = "vi" | "en";

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["vi", "en"];
export const DEFAULT_LOCALE: SupportedLocale = "vi";

/** The first device language tag that is vi or en; Vietnamese otherwise. */
export function matchSupportedLocale(languageTags: readonly string[]): SupportedLocale {
  for (const tag of languageTags) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (language === "vi" || language === "en") return language;
  }
  return DEFAULT_LOCALE;
}

export const i18n: I18nInstance = createInstance();

void i18n.init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  resources: { vi: { translation: vi }, en: { translation: en } },
  interpolation: { escapeValue: false },
  initAsync: false,
  react: { useSuspense: false },
});
