import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import vi from "./locales/vi.json";
import type { SupportedLocale } from "./types";

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

export function initI18n() {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      lng: "vi",
      fallbackLng: "vi",
      resources: withContent({ vi }),
      interpolation: { escapeValue: false },
      compatibilityJSON: "v4",
      initAsync: false,
      react: { useSuspense: false },
    });
  }
  return i18next;
}

/**
 * Vietnamese is the default and the fallback, so it is the only dictionary in
 * the initial bundle; every other locale arrives on demand. Nothing is
 * translated on the server (`./server.ts` is the only entry a server component
 * may import, and it resolves the locale without rendering a string), so a
 * locale that lands a tick after the first paint cannot mismatch server HTML.
 * Shipping every dictionary to every route instead would put the whole set in
 * the shared chunk — see scripts/bundle-budget.mjs.
 */
const loaders: Record<Exclude<SupportedLocale, "vi">, () => Promise<{ default: object }>> = {
  en: () => import("./locales/en.json"),
};

const loaded = new Set<string>(["vi"]);

export function registerLocaleBundle(locale: SupportedLocale, dict: object): void {
  if (loaded.has(locale)) return;
  if (Object.keys(dict).length > 0) {
    i18next.addResourceBundle(locale, "translation", dict, true, true);
  }
  loaded.add(locale);
}

export function applyLocaleSync(locale: SupportedLocale): void {
  initI18n();
  if (i18next.language !== locale) {
    // initAsync: false — language and bundles are applied before render continues.
    void i18next.changeLanguage(locale);
  }
}

export async function ensureLocale(locale: SupportedLocale): Promise<void> {
  if (loaded.has(locale)) return;
  const load = loaders[locale as Exclude<SupportedLocale, "vi">];
  if (!load) return;
  const dict = (await load()).default;
  registerLocaleBundle(locale, dict);
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
