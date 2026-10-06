import { SUPPORTED_LOCALES, type SupportedLocale } from "@uniwork/core/i18n";
import { desktopAppearanceResponseSchema, type DesktopAppearance, type ThemeChangedEvent } from "../shared/ipc";
import type { RendererBridge } from "./app";

/** The desktop app speaks Vietnamese unless the user's language is one the
 * shared dictionaries carry: the product's Vietnamese teams are its audience. */
export const DESKTOP_FALLBACK_LOCALE: SupportedLocale = "vi";

export type AppearanceBridge = RendererBridge & {
  onThemeChanged?(listener: (event: ThemeChangedEvent) => void): () => void;
};

/** First OS language whose primary subtag the shared i18n supports. */
export function pickDesktopLocale(languages: readonly string[]): SupportedLocale {
  for (const tag of languages) {
    const primary = tag.split(/[-_]/)[0]?.toLowerCase();
    const supported = SUPPORTED_LOCALES.find((locale) => locale === primary);
    if (supported) return supported;
  }
  return DESKTOP_FALLBACK_LOCALE;
}

/** Main's nativeTheme and OS languages; a host that cannot answer degrades to
 * what Chromium reports for the same machine. */
export async function readAppearance(bridge: RendererBridge): Promise<DesktopAppearance> {
  try {
    const parsed = desktopAppearanceResponseSchema.safeParse(await bridge.call("desktop:appearance", { sessionGeneration: "desktop-dev-session" }));
    if (parsed.success) return parsed.data;
  } catch { /* fall through to the renderer's own view of the system */ }
  return {
    dark: window.matchMedia?.("(prefers-color-scheme: dark)").matches === true,
    languages: typeof navigator === "undefined" ? [] : [...navigator.languages],
  };
}

export function applyDarkClass(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
}
