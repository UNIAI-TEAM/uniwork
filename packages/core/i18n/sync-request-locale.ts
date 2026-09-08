/**
 * Web SSR/hydration: apply the server-resolved locale synchronously before the
 * first client component renders. English is imported here so it stays out of
 * the shared `@uniwork/core/i18n` entry; only the web host pulls this module.
 */
import en from "./locales/en.json";
import { applyLocaleSync, initI18n, registerLocaleBundle } from "./index";
import type { SupportedLocale } from "./types";

export function syncRequestLocale(locale: SupportedLocale): void {
  initI18n();
  if (locale === "en") {
    registerLocaleBundle("en", en);
  }
  applyLocaleSync(locale);
}
