"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
} from "./settings-layout";
import { ThemesPanel } from "./themes-panel";
import { matchesTimezone, timezoneItems, type TimezoneItem } from "./timezone-options";
import { useAutoSave } from "./use-auto-save";

const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

type ZoneItem = TimezoneItem;

function sameZone(left: string, right: string) {
  return left === right;
}

export function PreferencesTab() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings" });
  const localeAdapter = useLocaleAdapter();
  const { user } = useSession();
  const patchMe = usePatchMe();
  const timezone = user?.timezone || DEFAULT_TIMEZONE;
  // The zone picked, shown at once; the account follows when the save lands.
  const [zoneDraft, setZoneDraft] = useState(timezone);
  useEffect(() => setZoneDraft(timezone), [timezone]);

  const currentLocale: SupportedLocale = SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
    ? (i18n.language as SupportedLocale)
    : DEFAULT_LOCALE;
  const zones = useMemo(() => timezoneItems(zoneDraft, currentLocale), [zoneDraft, currentLocale]);
  const selectedZone = zones.find((z) => z.value === zoneDraft) ?? null;

  const saveTimezone = useCallback(
    async (next: string) => {
      await patchMe.mutateAsync({ timezone: next });
    },
    [patchMe],
  );
  // A refused zone goes back to the saved one, so picking it again retries.
  const revertTimezone = useCallback(() => setZoneDraft(timezone), [timezone]);
  // The same inline state as every autosaved field: no toast either way.
  const zoneSave = useAutoSave({
    value: zoneDraft,
    savedValue: timezone,
    onSave: saveTimezone,
    onError: revertTimezone,
    enabled: !!user,
    delay: 0,
    isEqual: sameZone,
  });

  const languageOptions: { value: SupportedLocale; label: string }[] = [
    { value: "vi", label: t("preferences.languageVi") },
    { value: "en", label: t("preferences.languageEn") },
  ];

  // Like the theme and the accent, the language is kept on this browser and
  // shows itself: the page turns into it. There is no save to report.
  const handleLanguageChange = (next: SupportedLocale) => {
    if (next === currentLocale) return;
    // The adapter keeps the choice on this browser (a cookie on web), so the
    // server renders the next page in it; the account's locale is untouched.
    localeAdapter.persist(next);
    void setLocale(next);
    document.documentElement.lang = next;
  };

  const zoneSaving = zoneSave.status === "saving";
  const handleTimezoneChange = (next: ZoneItem | null) => {
    if (!next || next.value === zoneDraft || zoneSaving) return;
    setZoneDraft(next.value);
  };

  return (
    <SettingsTab title={t("page.tabs.preferences")}>
      <ThemesPanel />
      <SettingsSection
        title={t("preferences.section")}
        action={
          <SettingsSaveState
            status={zoneSave.status}
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
              <SelectTrigger className="w-full" aria-label={t("preferences.language")}>
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
          <SettingsRow label={t("preferences.timezone")} description={t("preferences.timezoneHint")} size="text">
            <Combobox
              items={zones}
              value={selectedZone}
              itemToStringLabel={(z: ZoneItem) => z.label}
              itemToStringValue={(z: ZoneItem) => z.value}
              isItemEqualToValue={(a: ZoneItem, b: ZoneItem) => a.value === b.value}
              // Accent- and case-blind, over the label, the IANA id and city
              // aliases: "ha noi" finds Vietnam's zone.
              filter={(z: ZoneItem, query: string) => matchesTimezone(z, query)}
              onValueChange={handleTimezoneChange}
              // A pick made while the last one saves would be dropped; hold the
              // list still (focus stays) until the server answers.
              readOnly={zoneSaving}
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
