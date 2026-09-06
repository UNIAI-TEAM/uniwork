"use client";

import type { ComponentType } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from "@uniwork/core/i18n";
import { useLocaleAdapter } from "@uniwork/core/i18n/react";
import { usePatchMe, useSession } from "@uniwork/core/auth";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { NativeSelect } from "@uniwork/ui/components/ui/native-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "./settings-layout";

type ThemeValue = "light" | "dark" | "system";

const THEME_ICONS: Record<ThemeValue, ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

function ThemeOptionLabel({
  value,
  label,
}: {
  value: ThemeValue;
  label: string;
}) {
  const Icon = THEME_ICONS[value];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {label}
    </span>
  );
}

export function PreferencesTab() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings" });
  const { theme, setTheme } = useTheme();
  const localeAdapter = useLocaleAdapter();
  const { user } = useSession();
  const patchMe = usePatchMe();
  const timezone = user?.timezone ?? DEFAULT_TIMEZONE;
  const zones = timezoneOptions(timezone);

  const currentLocale: SupportedLocale = SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
    ? (i18n.language as SupportedLocale)
    : DEFAULT_LOCALE;

  // next-themes returns undefined until mounted — keep a stable Select value.
  const themeValue: ThemeValue =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";

  const themeOptions: { value: ThemeValue; label: string }[] = [
    { value: "light", label: t("preferences.themeLight") },
    { value: "dark", label: t("preferences.themeDark") },
    { value: "system", label: t("preferences.themeSystem") },
  ];

  const languageOptions: { value: SupportedLocale; label: string }[] = [
    { value: "vi", label: t("preferences.languageVi") },
    { value: "en", label: t("preferences.languageEn") },
  ];

  const activeTheme = themeOptions.find((option) => option.value === themeValue);

  const handleLanguageChange = (next: SupportedLocale) => {
    if (next === currentLocale) return;
    localeAdapter.persist(next);
    void i18n.changeLanguage(next);
    document.documentElement.lang = next;
    toast.success(t("preferences.toastSaved"), { id: "settings-auto-save" });
  };

  return (
    <SettingsTab title={t("page.tabs.preferences")}>
      <SettingsSection title={t("preferences.section")}>
        <SettingsCard>
          <SettingsRow label={t("preferences.theme")} size="select">
            <Select
              items={themeOptions}
              value={themeValue}
              onValueChange={(next) => {
                if (!next || next === themeValue) return;
                setTheme(next as ThemeValue);
                toast.success(t("preferences.toastSaved"), { id: "settings-auto-save" });
              }}
            >
              <SelectTrigger size="sm" className="w-full" aria-label={t("preferences.theme")}>
                <SelectValue>
                  {activeTheme ? (
                    <ThemeOptionLabel value={activeTheme.value} label={activeTheme.label} />
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {themeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <ThemeOptionLabel value={option.value} label={option.label} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow label={t("preferences.language")} size="select">
            <Select
              items={languageOptions}
              value={currentLocale}
              onValueChange={(next) => {
                if (!next) return;
                handleLanguageChange(next as SupportedLocale);
              }}
            >
              <SelectTrigger size="sm" className="w-full" aria-label={t("preferences.language")}>
                <SelectValue>
                  {languageOptions.find((option) => option.value === currentLocale)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {languageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow label={t("preferences.timezone")} size="select">
            <NativeSelect
              aria-label={t("preferences.timezone")}
              value={timezone}
              disabled={patchMe.isPending}
              onChange={(e) => {
                const next = e.target.value;
                if (!next || next === timezone) return;
                patchMe.mutate(
                  { timezone: next },
                  {
                    onSuccess: () => toast.success(t("preferences.toastSaved"), { id: "settings-auto-save" }),
                    onError: () => toast.error(t("preferences.toastError")),
                  },
                );
              }}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </NativeSelect>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}

const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

/** Every IANA zone the engine knows, or a short list where Intl cannot say. */
function timezoneOptions(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : ["Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "UTC"];
  return all.includes(current) ? all : [current, ...all];
}
