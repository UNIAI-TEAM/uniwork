import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, parseAcceptLanguage, resolveLocale, type SupportedLocale } from "@uniwork/core/i18n/server";


/**
 * The locale for this request, decided once on the server: the cookie a
 * language picker writes, else the browser's Accept-Language (stable locales
 * only, see `resolveLocale`), else Vietnamese. The root layout renders
 * `<html lang>` and seeds i18n with it, and the client starts from the same
 * value — the page must not change language between server render and
 * hydration.
 */
export async function resolveRequestLocale(): Promise<SupportedLocale> {
  const choice = (await cookies()).get(LOCALE_COOKIE)?.value;
  return resolveLocale(choice, parseAcceptLanguage((await headers()).get("accept-language")));
}
