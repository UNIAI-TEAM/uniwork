import { desktopAppearanceResponseSchema, type DesktopAppearance } from "../shared/ipc";

const MAX_LANGUAGES = 16;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8}){0,4}$/;

export type LanguageSource = {
  getLocale(): string;
  getPreferredSystemLanguages?(): string[];
  commandLine?: { hasSwitch(name: string): boolean };
};

/** The OS language list, most preferred first. An explicit `--lang` switch
 * (Chromium's own override, used by smoke and visual runs) wins over the
 * system list; app.getLocale() closes it as the UI locale Chromium chose. */
export function systemLanguages(app: LanguageSource): string[] {
  const explicit = app.commandLine?.hasSwitch("lang") ? [app.getLocale()] : [];
  const preferred = typeof app.getPreferredSystemLanguages === "function" ? app.getPreferredSystemLanguages() : [];
  const seen = new Set<string>();
  const languages: string[] = [];
  for (const tag of [...explicit, ...preferred, app.getLocale()]) {
    if (typeof tag !== "string" || !LANGUAGE_TAG.test(tag) || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    languages.push(tag);
    if (languages.length === MAX_LANGUAGES) break;
  }
  return languages;
}

export type AppearanceOptions = { snapshot(): DesktopAppearance };

export function createAppearanceIpcHandler(options: AppearanceOptions) {
  return { "desktop:appearance": () => desktopAppearanceResponseSchema.parse(options.snapshot()) };
}
