// Locale resolution without React: the only entry a server component may
// import. `./index` pulls in react-i18next, which Next refuses to evaluate on
// the server; this file re-exports the pure pieces a request handler needs.
export { LOCALE_COOKIE } from "./browser-cookie-adapter";
export { matchLocale, parseAcceptLanguage } from "./pick-locale";
export { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./types";
export { BUNDLED_LOCALES, bundledDictionary, loadDictionary } from "./dictionaries";
export type { SupportedLocale } from "./types";
