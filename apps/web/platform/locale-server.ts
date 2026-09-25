import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, matchLocale, parseAcceptLanguage, type SupportedLocale } from "@uniwork/core/i18n/server";


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
