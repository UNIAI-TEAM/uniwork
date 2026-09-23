"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, setLocale, type SupportedLocale } from "@uniwork/core/i18n";
import { useLocaleAdapter } from "@uniwork/core/i18n/react";
import { usePatchMe, useSession } from "@uniwork/core/auth";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@uniwork/ui/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveState,
  SettingsSection,
  SettingsTab,
  type SettingsSaveStatus,
} from "./settings-layout";
import { ThemesPanel } from "./themes-panel";
import { timezoneItems } from "./timezone-options";

const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

type ZoneItem = ReturnType<typeof timezoneItems>[number];

export function PreferencesTab() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings" });
  const localeAdapter = useLocaleAdapter();
  const { user } = useSession();
  const patchMe = usePatchMe();
  const [status, setStatus] = useState<SettingsSaveStatus>("idle");
  const timezone = user?.timezone || DEFAULT_TIMEZONE;
  const zones = useMemo(() => timezoneItems(timezone), [timezone]);
  const selectedZone = zones.find((z) => z.value === timezone) ?? null;

  const currentLocale: SupportedLocale = SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
    ? (i18n.language as SupportedLocale)
    : DEFAULT_LOCALE;

  const languageOptions: { value: SupportedLocale; label: string }[] = [
    { value: "vi", label: t("preferences.languageVi") },
    { value: "en", label: t("preferences.languageEn") },
  ];

  const handleLanguageChange = (next: SupportedLocale) => {
    if (next === currentLocale) return;
    // The adapter keeps the choice on this browser (a cookie on web), so the
    // server renders the next page in it; the account's locale is untouched.
    localeAdapter.persist(next);
    void setLocale(next);
    document.documentElement.lang = next;
    setStatus("saved");
  };

  const handleTimezoneChange = (next: ZoneItem | null) => {
    if (!next || next.value === timezone || patchMe.isPending) return;
    setStatus("saving");
    patchMe.mutate(
      { timezone: next.value },
      {
        onSuccess: () => setStatus("saved"),
        onError: () => {
          setStatus("error");
          toast.error(t("preferences.toastError"));
        },
      },
    );
  };

  return (
    <SettingsTab title={t("page.tabs.preferences")}>
      <ThemesPanel />
      <SettingsSection
        title={t("preferences.section")}
        action={
          <SettingsSaveState
            status={status}
            savingLabel={t("save.saving")}
            savedLabel={t("save.saved")}
            errorLabel={t("save.error")}
          />
        }
      >
        <SettingsCard>
          <SettingsRow label={t("preferences.language")} description={t("preferences.languageHint")} size="select">
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
          <SettingsRow label={t("preferences.timezone")} description={t("preferences.timezoneHint")} size="select-wide">
            <Combobox
              items={zones}
              value={selectedZone}
              itemToStringLabel={(z: ZoneItem) => z.label}
              itemToStringValue={(z: ZoneItem) => z.value}
              isItemEqualToValue={(a: ZoneItem, b: ZoneItem) => a.value === b.value}
              onValueChange={handleTimezoneChange}
            >
              <ComboboxInput
                className="w-full"
                aria-label={t("preferences.timezone")}
                placeholder={t("preferences.timezoneSearch")}
              />
              <ComboboxContent align="end">
                <ComboboxEmpty>{t("preferences.timezoneEmpty")}</ComboboxEmpty>
                <ComboboxList>
                  {(z: ZoneItem) => (
                    <ComboboxItem key={z.value} value={z}>
                      {z.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}
