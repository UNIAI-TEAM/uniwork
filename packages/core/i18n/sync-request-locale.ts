/**
 * Web SSR/hydration: apply the server-resolved locale synchronously before the
 * first client component renders. English is NOT imported here — a static
 * `en.json` import would land in every route's shared chunk (~25 KB gzip)
 * even for Vietnamese sessions (scripts/bundle-budget.mjs). The web host
 * loads the dictionary on the server when `locale === "en"` and passes it in.
 */
import { applyLocaleSync, initI18n, registerLocaleBundle } from "./index";
import type { SupportedLocale } from "./types";

export function syncRequestLocale(locale: SupportedLocale, dictionary?: object): void {
  initI18n();
  if (locale === "en" && dictionary) {
    registerLocaleBundle("en", dictionary);
  }
  applyLocaleSync(locale);
}
