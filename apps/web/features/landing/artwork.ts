import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from "@uniwork/core/i18n/types";

/**
 * Which piece of landing artwork to load, and in which language.
 *
 * Five of the six images draw an interface, and an interface has words on it.
 * Those words are pixels: they cannot be translated at runtime, measured for
 * contrast, or read aloud, so each one is rendered once per locale and picked
 * here instead. The hero draws people and no interface, so it has no words and
 * exists once.
 *
 * The generator is the other half of this contract:
 * scripts/landing/prompts.json carries the same `localized` flag, and
 * scripts/landing-artwork.test.mjs fails when the two disagree or when a file
 * this map promises is not on disk. That test reads this map as text rather
 * than importing it, which is why the map stays module-private: exporting it
 * for a reader that never imports it is the unused export `pnpm knip` fails on.
 */
const ARTWORK = {
  hero: false,
  meetings: true,
  "projects-tasks": true,
  "chat-tasks": true,
  "email-hub": true,
  "ai-workforce": true,
  "work-products": true,
} as const satisfies Record<string, boolean>;

export type ArtworkName = keyof typeof ARTWORK;

/** `i18n.language` can arrive as a full tag ("vi-VN"); the files are "vi"/"en". */
function toLocale(language: string | undefined): SupportedLocale {
  const base = (language ?? "").split("-")[0];
  return SUPPORTED_LOCALES.includes(base as SupportedLocale) ? (base as SupportedLocale) : DEFAULT_LOCALE;
}

function artworkSrc(name: ArtworkName, locale: SupportedLocale): string {
  return ARTWORK[name] ? `/landing/${name}.${locale}.webp` : `/landing/${name}.webp`;
}

/**
 * Resolved from the same i18n instance that renders the copy beside it, so the
 * picture and the sentence under it can never end up in different languages,
 * and the server frame and the client frame agree on one src.
 */
export function useArtwork(): (name: ArtworkName) => string {
  const { i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  return (name) => artworkSrc(name, locale);
}
