// A beta locale for language-picker tests. None ships yet (PRODUCT.md keeps
// Myanmar, Khmer and Lao roadmap-only), but every picker has to label one the
// day it lands. Call from a vi.mock factory, which is hoisted above static
// imports, so load this module there with `await import(...)`.
import type * as I18n from "@uniwork/core/i18n";

const BETA_LOCALE = "km";

export function withBetaLocale(real: typeof I18n): typeof I18n {
  return {
    ...real,
    SUPPORTED_LOCALES: [...real.SUPPORTED_LOCALES, BETA_LOCALE] as typeof real.SUPPORTED_LOCALES,
    LOCALE_NATIVE_NAMES: {
      ...real.LOCALE_NATIVE_NAMES,
      [BETA_LOCALE]: "ភាសាខ្មែរ",
    } as typeof real.LOCALE_NATIVE_NAMES,
  };
}
