// The app's language outside its screens. lib/i18n/provider.tsx applies it
// for the UI; a headless task (an Android call push while UniChat is closed)
// has no provider, so its ringing notification reads the same choice here:
// the person's Settings choice in SecureStore, else the phone's language.
import * as Localization from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { i18n, matchSupportedLocale, type SupportedLocale } from "@/lib/i18n/singleton";

/** The Settings › Language choice in SecureStore (lib/i18n/provider.tsx writes it). */
export const LOCALE_KEY = "locale_preference";

let applied = false;

/** Reads the choice once per runtime and switches the i18n instance to it. */
export async function applyStoredLocale(): Promise<SupportedLocale> {
  let saved: string | null = null;
  try {
    saved = await SecureStore.getItemAsync(LOCALE_KEY);
  } catch {
    // An unreadable preference falls back to the phone's language.
  }
  const locale = saved === "vi" || saved === "en" ? saved : matchSupportedLocale(Localization.getLocales().map((entry) => entry.languageTag));
  if (!applied || i18n.language !== locale) await i18n.changeLanguage(locale);
  applied = true;
  return locale;
}
