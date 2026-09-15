"use client";

import { useTranslation } from "react-i18next";
import { LOCALE_NATIVE_NAMES, isBetaLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { Badge } from "@uniwork/ui/components/ui/badge";

/**
 * "Beta" beside a locale that is not at parity with Vietnamese, nothing beside
 * one that is. PRODUCT.md flags Myanmar, Khmer and Lao beta wherever they
 * appear; every language picker renders through here, so a locale added to
 * `SUPPORTED_LOCALES` arrives already labelled.
 */
export function LocaleBetaBadge({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  if (!isBetaLocale(locale)) return null;
  return <Badge variant="outline">{t("common.beta")}</Badge>;
}

/**
 * A locale as a picker lists it: its own name, marked with its language so a
 * screen reader pronounces it right, then the badge.
 */
export function LocaleName({ locale }: { locale: SupportedLocale }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span lang={locale} className="truncate">
        {LOCALE_NATIVE_NAMES[locale]}
      </span>
      <LocaleBetaBadge locale={locale} />
    </span>
  );
}
