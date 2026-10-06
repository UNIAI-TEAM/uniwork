import { desktopAppearanceResponseSchema, type DesktopAppearance } from "../shared/ipc";

const MAX_LANGUAGES = 16;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8}){0,4}$/;

export type LanguageSource = {
  getLocale(): string;
  getPreferredSystemLanguages?(): string[];
  commandLine?: { hasSwitch(name: string): boolean };
};

/** The language candidates, most preferred first:
 * 1. an explicit `--lang` switch (Chromium's own override, used by smoke and
 *    visual runs) is the whole list, so `--lang=fr` means "French", never
 *    "whatever else the OS lists";
 * 2. otherwise the OS preferred languages, in the user's order.
 * app.getLocale() is not a fallback: Chromium falls back to en-US for a
 * language it lacks, which would beat the Vietnamese default. The first
 * supported tag wins, else vi (main/strings.ts resolveDesktopLocale, and
 * renderer/appearance.ts pickDesktopLocale on the same list). */
export function systemLanguages(app: LanguageSource): string[] {
  const candidates = app.commandLine?.hasSwitch("lang")
    ? [app.getLocale()]
    : typeof app.getPreferredSystemLanguages === "function" ? app.getPreferredSystemLanguages() : [];
  const seen = new Set<string>();
  const languages: string[] = [];
  for (const tag of candidates) {
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
