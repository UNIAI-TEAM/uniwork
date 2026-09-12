import { cookies, headers } from "next/headers";
import {
  loadDictionary,
  LOCALE_COOKIE,
  matchLocale,
  parseAcceptLanguage,
  type SupportedLocale,
} from "@uniwork/core/i18n/server";


/**
 * The locale for this request, decided once on the server: the cookie the
 * settings page writes, else the browser's Accept-Language, else Vietnamese.
 * The root layout renders `<html lang>` and seeds i18n with it, and the client
 * starts from the same value — the page must not change language between
 * server render and hydration.
 */
export async function resolveRequestLocale(): Promise<SupportedLocale> {
  const choice = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (choice) return matchLocale([choice]);
  return matchLocale(parseAcceptLanguage((await headers()).get("accept-language")));
}

/**
 * The dictionary the browser cannot already have, read here so the first
 * client render matches the server's. Null for a locale that ships in the JS
 * bundle: sending those strings again in the server payload would double them.
 */
export async function resolveRequestMessages(
  locale: SupportedLocale,
): Promise<Record<string, unknown> | null> {
  return await loadDictionary(locale);
}
