import { match } from "@formatjs/intl-localematcher";
import {
  DEFAULT_LOCALE,
  STABLE_LOCALES,
  SUPPORTED_LOCALES,
  type LocaleAdapter,
  type SupportedLocale,
} from "./types";

export function matchLocale(
  candidates: readonly string[],
  available: readonly SupportedLocale[] = SUPPORTED_LOCALES,
): SupportedLocale {
  if (candidates.length === 0) return DEFAULT_LOCALE;
  try {
    return match(candidates, available, DEFAULT_LOCALE) as SupportedLocale;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * The locale policy both hosts share: the browser through `pickLocale`, the
 * server through `resolveRequestLocale`. A choice the user made wins, a beta
 * locale included. The browser's own languages only ever select a stable one,
 * so nobody lands in a partial translation they did not pick beside its Beta
 * label.
 */
export function resolveLocale(
  choice: string | null | undefined,
  preferences: readonly string[],
): SupportedLocale {
  if (choice) return matchLocale([choice]);
  return matchLocale(preferences, STABLE_LOCALES);
}

export function pickLocale(adapter: LocaleAdapter): SupportedLocale {
  return resolveLocale(adapter.getUserChoice(), adapter.getSystemPreferences());
}

/**
 * Accept-Language → ordered candidate list, the server-side twin of
 * `navigator.languages`, so a request and the browser that made it resolve
 * to the same locale and the page hydrates without a language flip.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const weight = q === undefined ? 1 : Number(q);
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((c) => c.tag !== "" && c.tag !== "*" && c.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((c) => c.tag);
}
