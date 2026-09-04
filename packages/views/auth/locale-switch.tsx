"use client";
import { useTranslation } from "react-i18next";
import type { SupportedLocale } from "@uniwork/core/i18n";
import { useLocaleAdapter } from "@uniwork/core/i18n/react";
import { Button } from "@uniwork/ui/components/ui/button";

/**
 * The one control a signed-out screen needs that the workspace top bar also
 * has: a way to change language. Before sign-in the language is the browser's
 * guess, and the credential screens are the only place a user with an
 * en-US Chrome and a Vietnamese team can correct it before any account exists.
 *
 * Two languages, so it is a button and not a menu. Its label is the OTHER
 * language's name, written in that language: whoever cannot read the current
 * one can still find the way out. `lang` on the button tells a screen reader
 * to pronounce it accordingly.
 */
export function LocaleSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const localeAdapter = useLocaleAdapter();
  const current: SupportedLocale = i18n.language === "en" ? "en" : "vi";
  const target: SupportedLocale = current === "vi" ? "en" : "vi";
  const label = target === "vi" ? t("settings.preferences.languageVi") : t("settings.preferences.languageEn");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      lang={target}
      aria-label={t("auth.switchTo", { language: label })}
      className={className}
      onClick={() => {
        localeAdapter.persist(target);
        void i18n.changeLanguage(target);
        document.documentElement.lang = target;
      }}
    >
      {label}
    </Button>
  );
}
