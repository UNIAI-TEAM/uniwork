export type SupportedLocale = "vi" | "en";

export const SUPPORTED_LOCALES: SupportedLocale[] = ["vi", "en"];
export const DEFAULT_LOCALE: SupportedLocale = "vi";

/**
 * Locales at full parity with Vietnamese, the source language; `parity.test.ts`
 * holds them there. Every other supported locale is beta: labelled wherever it
 * is offered, and selected only by the user, never from the browser's
 * languages (`resolveLocale`). PRODUCT.md keeps Myanmar, Khmer and Lao beta
 * until the product owner promotes them — promotion is adding the code here,
 * and the parity gate then demands every key.
 */
export const STABLE_LOCALES: SupportedLocale[] = ["vi", "en"];

/**
 * Each language's name for itself. Pickers show these whatever the UI
 * language is, so someone who cannot read the current one still finds theirs.
 */
export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  vi: "Tiếng Việt",
  en: "English",
};

export function isBetaLocale(locale: SupportedLocale): boolean {
  return !STABLE_LOCALES.includes(locale);
}

export type LocaleResources = Record<string, Record<string, unknown>>;

export interface LocaleAdapter {
  getUserChoice(): string | null;
  getSystemPreferences(): string[];
  persist(locale: SupportedLocale): void;
}
