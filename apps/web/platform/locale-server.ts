import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, matchLocale, type SupportedLocale } from "@uniwork/core/i18n/server";


/**
 * The locale for this request, decided once on the server: the cookie the
 * settings page writes, else English. Accept-Language is deliberately not
 * read — English is the product default, whatever the browser prefers; a
 * Vietnamese speaker switches once and the cookie remembers.
 * The root layout renders `<html lang>` and seeds i18n with it, and the client
 * starts from the same value — the page must not change language between
 * server render and hydration.
 */
export async function resolveRequestLocale(): Promise<SupportedLocale> {
  const choice = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (choice) return matchLocale([choice]);
  return DEFAULT_LOCALE;
}
