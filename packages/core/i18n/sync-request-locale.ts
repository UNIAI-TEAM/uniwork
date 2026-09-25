/**
 * Web SSR/hydration: apply the server-resolved locale synchronously before the
 * first client component renders. Vietnamese is NOT imported here — a static
 * `vi.json` import would land in every route's shared chunk (~25 KB gzip)
 * even for English sessions (scripts/bundle-budget.mjs). The web host
 * loads the dictionary on the server when `locale === "vi"` and passes it in.
 */
import { applyLocaleSync, initI18n, registerLocaleBundle } from "./index";
import type { SupportedLocale } from "./types";

export function syncRequestLocale(locale: SupportedLocale, dictionary?: object): void {
  initI18n();
  if (locale === "vi" && dictionary) {
    registerLocaleBundle("vi", dictionary);
  }
  applyLocaleSync(locale);
}
