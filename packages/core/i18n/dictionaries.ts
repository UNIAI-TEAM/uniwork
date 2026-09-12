import vi from "./locales/vi.json";
import { SUPPORTED_LOCALES, type SupportedLocale } from "./types";

/**
 * The dictionaries, with no React in the import graph.
 *
 * This is a separate module from `./index` for the same reason `./server.ts`
 * is: `./index` pulls in react-i18next, and Next refuses to evaluate that in a
 * server component. The root layout has to read a dictionary on the server —
 * that is what keeps the first client render in the same language — so the
 * loading half lives here and both entries re-export it.
 */

/**
 * Locales whose dictionary is compiled into the initial JS bundle. Everything
 * else reaches the browser through the server payload or `ensureLocale`.
 */
export const BUNDLED_LOCALES: readonly SupportedLocale[] = ["vi"];

/** The bundled dictionary for a locale, or null when it is fetched on demand. */
export function bundledDictionary(locale: SupportedLocale): Record<string, unknown> | null {
  return locale === "vi" ? (vi as Record<string, unknown>) : null;
}

/**
 * Vietnamese is the default and the fallback, so it is the only dictionary in
 * the initial bundle; every other locale arrives on demand. Shipping every
 * dictionary to every route instead would put the whole set in the shared
 * chunk — see scripts/bundle-budget.mjs.
 */
export const loaders: Record<Exclude<SupportedLocale, "vi">, () => Promise<{ default: object }>> = {
  en: () => import("./locales/en.json"),
};

/**
 * A locale's dictionary, without touching any shared i18next instance.
 *
 * The server calls this and hands the result to the browser, which is the only
 * way a non-bundled locale can be present at the FIRST client render. Returns
 * null for a bundled locale: the browser already has those strings, and
 * repeating them in the server payload would send the same 130 KB twice.
 */
export async function loadDictionary(locale: SupportedLocale): Promise<Record<string, unknown> | null> {
  if (!SUPPORTED_LOCALES.includes(locale) || BUNDLED_LOCALES.includes(locale)) return null;
  const load = loaders[locale as Exclude<SupportedLocale, "vi">];
  if (!load) return null;
  const dict = (await load()).default as Record<string, unknown>;
  return Object.keys(dict).length > 0 ? dict : null;
}

export { vi };
