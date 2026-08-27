import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

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
      resources: withContent({ vi, en }),
      interpolation: { escapeValue: false },
    });
  }
  return i18next;
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
