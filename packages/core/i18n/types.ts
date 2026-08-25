export type SupportedLocale = "vi" | "en";

export const SUPPORTED_LOCALES: SupportedLocale[] = ["vi", "en"];
export const DEFAULT_LOCALE: SupportedLocale = "vi";

export type LocaleResources = Record<string, Record<string, unknown>>;

export interface LocaleAdapter {
  getUserChoice(): string | null;
  getSystemPreferences(): string[];
  persist(locale: SupportedLocale): void;
}
