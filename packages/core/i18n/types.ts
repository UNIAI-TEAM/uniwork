export type SupportedLocale = "vi" | "en";

export const SUPPORTED_LOCALES: SupportedLocale[] = ["vi", "en"];
/** English is the product default: what anyone sees until they pick a language. */
export const DEFAULT_LOCALE: SupportedLocale = "en";

export type LocaleResources = Record<string, Record<string, unknown>>;

export interface LocaleAdapter {
  getUserChoice(): string | null;
  getSystemPreferences(): string[];
  persist(locale: SupportedLocale): void;
}
