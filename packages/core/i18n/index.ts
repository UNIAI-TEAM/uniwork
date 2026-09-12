import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { SupportedLocale } from "./types";
import { loaders, vi } from "./dictionaries";

/**
 * Chỉ nạp locale nào THẬT SỰ có chuỗi. Đăng ký một file rỗng khiến i18next báo
 * có ngôn ngữ đó trong khi mọi chuỗi đều rơi về tiếng Việt — đổi `lng` là ra một
 * app "tiếng Anh" nói tiếng Việt. `vi` và `en` hiện đã ngang nhau (xem
 * `parity.test.ts`); thêm locale mới chỉ cần đổ nội dung vào file, không phải
 * sửa gì ở đây.
 */
function withContent(resources: Record<string, object>) {
  return Object.fromEntries(
    Object.entries(resources)
      .filter(([, dict]) => Object.keys(dict).length > 0)
      .map(([lng, dict]) => [lng, { translation: dict }]),
  );
}

/** Locales whose dictionary is already registered on the shared instance. */
const loaded = new Set<string>(["vi"]);

/**
 * The browser's one i18next, initialised at the locale the server already
 * rendered rather than at `vi` and switched a tick later.
 *
 * `seed` carries the dictionary for a locale that is not in the bundle; the
 * host reads it out of the server payload, so the first client render has the
 * same strings the server used and hydration has nothing to reconcile.
 * `initAsync: false` is what makes that first render synchronous — without it
 * i18next defers, and the tree paints once in the fallback language.
 */
export function initI18n(locale: SupportedLocale = "vi", seed?: Record<string, unknown> | null) {
  if (!i18next.isInitialized) {
    if (seed) loaded.add(locale);
    void i18next.use(initReactI18next).init({
      lng: locale,
      fallbackLng: "vi",
      resources: withContent({ vi, ...(seed ? { [locale]: seed } : {}) }),
      interpolation: { escapeValue: false },
      compatibilityJSON: "v4",
      initAsync: false,
    });
  }
  return i18next;
}

/**
 * Registers a locale's strings on the shared instance, fetching them the first
 * time. Idempotent and additive: it never changes the active language, so it
 * is safe to call from anywhere.
 */
export async function ensureLocale(locale: SupportedLocale): Promise<void> {
  if (loaded.has(locale)) return;
  const load = loaders[locale as Exclude<SupportedLocale, "vi">];
  if (!load) return;
  const dict = (await load()).default;
  if (Object.keys(dict).length > 0) {
    i18next.addResourceBundle(locale, "translation", dict, true, true);
  }
  loaded.add(locale);
}

/**
 * The one way to switch language: load the dictionary, then switch. Calling
 * `i18n.changeLanguage` directly would show the fallback until the bundle
 * lands.
 */
export async function setLocale(locale: SupportedLocale): Promise<void> {
  await ensureLocale(locale);
  await i18next.changeLanguage(locale);
}

// The adapter layer ported from usf. `initI18n` above stays the app's entry
// point; these are the pieces platform code and future hosts need — the locale
// contract, the cookie-backed adapter, and the provider.
export type {
  SupportedLocale,
  LocaleResources,
  LocaleAdapter,
} from "./types";
export { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./types";
export { matchLocale, parseAcceptLanguage, pickLocale } from "./pick-locale";
export { createBrowserCookieLocaleAdapter, LOCALE_COOKIE } from "./browser-cookie-adapter";
export { BUNDLED_LOCALES, bundledDictionary, loadDictionary } from "./dictionaries";
