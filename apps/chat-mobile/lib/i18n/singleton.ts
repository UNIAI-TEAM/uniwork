// Ported from usf apps/mobile/lib/i18n/{singleton,types}.ts. One i18next
// instance over the bundles scripts/sync-i18n.mjs generates; nested keys as
// on the web (`auth.desktop.unichat_login_title`). Free of React Native so
// Node tests and pure helpers share it; the provider applies the device
// language once native modules exist.
import { createInstance, type i18n as I18nInstance } from "i18next";
import en from "@/locales/en.json";
import vi from "@/locales/vi.json";
import { numberFormat } from "../locale-format";

export type SupportedLocale = "vi" | "en";

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["vi", "en"];
export const DEFAULT_LOCALE: SupportedLocale = "vi";

/**
 * The first device language tag that is vi or en. A phone that lists only other languages reads English: a
 * Japanese or Korean manager at a Vietnamese company reads English sooner than Vietnamese. No language at
 * all (a headless runtime that cannot tell) keeps the default, Vietnamese.
 */
export function matchSupportedLocale(languageTags: readonly string[]): SupportedLocale {
  for (const tag of languageTags) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (language === "vi" || language === "en") return language;
  }
  return languageTags.length > 0 ? "en" : DEFAULT_LOCALE;
}

/**
 * Every {{count}} in the copy is written in the language's number format: "1.500 kết quả", "1,500 results" (audit
 * "number-format-and-server-copy"). Only counts: any other number a string interpolates (a year, a code) stays as
 * given. No string uses i18next's own `{{x, number}}` formats, so this replaces its formatter (lib/i18n.test.ts).
 */
export const countFormatter = {
  type: "formatter" as const,
  init: (): void => undefined,
  add: (): void => undefined,
  addCached: (): void => undefined,
  format: (value: unknown, format?: string, lng?: string, options?: { interpolationkey?: string }): unknown =>
    format === undefined && options?.interpolationkey === "count" && typeof value === "number" ? numberFormat(lng).format(value) : value,
};

export const i18n: I18nInstance = createInstance().use(countFormatter);

void i18n.init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  resources: { vi: { translation: vi }, en: { translation: en } },
  // alwaysFormat: a bare {{count}} reaches countFormatter too, not only a `{{x, format}}`.
  interpolation: { escapeValue: false, alwaysFormat: true },
  initAsync: false,
  react: { useSuspense: false },
});
