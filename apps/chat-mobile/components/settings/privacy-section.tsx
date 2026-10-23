// Settings › Privacy & security: lock UniChat behind Face ID, a fingerprint or
// the phone's passcode (and how long it may stay away before it locks again),
// and block screenshots and screen recording; and the anonymous usage counters, which
// the person may turn off (data/analytics.ts). Turning the lock on asks for the owner's
// proof first, so nobody turns on a lock they cannot open; a phone with no
// screen lock at all says so instead. Turning it off asks too: whoever holds
// an unlocked phone must not switch the lock off for later. The choices are this phone's
// (components/app/privacy.ts), applied at once; the guard
// (components/app/privacy-guard.tsx) carries them out. What the person's
// organization requires (the floor) reads on, cannot be moved, and says why.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAnnounce } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { RELOCK_AFTER_MS, relockFromValue, relockLabel, type RelockAfterMs } from "@/lib/app-lock";
import { authenticateOwner, deviceCanLock, updatePrivacySettings, usePrivacySettings } from "@/components/app/privacy";
import { OptionGroup, type Option } from "./option-group";
import { SettingsSection } from "./settings-section";
import { SwitchRow } from "./switch-row";

const RELOCK_OPTIONS: Option<`${RelockAfterMs}`>[] = RELOCK_AFTER_MS.map((ms) => ({ value: `${ms}`, label: relockLabel(ms) }));

export function PrivacySection({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { settings, floor, loaded } = usePrivacySettings();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onAppLock = async (next: boolean) => {
    setNotice(null);
    setBusy(true);
    try {
      if (!next) {
        if (await authenticateOwner(t("mobile.security.unlock_prompt"), t("common.cancel"))) updatePrivacySettings({ appLock: false });
        return;
      }
      if (!(await deviceCanLock())) {
        setNotice("mobile.security.app_lock_unavailable");
        return;
      }
      if (await authenticateOwner(t("mobile.security.unlock_prompt"), t("common.cancel"))) updatePrivacySettings({ appLock: true });
    } finally {
      setBusy(false);
    }
  };

  // The notice's live region is TalkBack's; VoiceOver hears it through an announcement.
  useAnnounce(notice ? t(notice) : null);

  return (
    <>
      <SettingsSection title={t("mobile.security.section")}>
        {children}
        <SwitchRow
          first={!children}
          icon="lock-closed-outline"
          tint="green"
          label={t("mobile.security.app_lock")}
          hint={floor.appLock ? t("mobile.security.app_lock_org") : t("mobile.security.app_lock_hint")}
          value={settings.appLock}
          disabled={!loaded || busy || floor.appLock}
          onChange={(next) => void onAppLock(next)}
        />
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="px-4 pb-3 text-callout text-destructive">
            {t(notice)}
          </Text>
        ) : null}
        <SwitchRow
          icon="eye-off-outline"
          tint="teal"
          label={t("mobile.security.screen_security")}
          hint={floor.screenSecurity ? t("mobile.security.screen_security_org") : t("mobile.security.screen_security_hint")}
          value={settings.screenSecurity}
          disabled={!loaded || floor.screenSecurity}
          onChange={(next) => updatePrivacySettings({ screenSecurity: next })}
        />
        <SwitchRow
          icon="stats-chart-outline"
          tint="blue"
          label={t("mobile.security.usage_stats")}
          hint={t("mobile.security.usage_stats_hint")}
          value={settings.usageStats}
          disabled={!loaded}
          onChange={(next) => updatePrivacySettings({ usageStats: next })}
        />
      </SettingsSection>
      {settings.appLock ? (
        <OptionGroup
          title={t("mobile.security.app_lock_after")}
          options={RELOCK_OPTIONS}
          value={`${settings.relockAfterMs}`}
          onChange={(value) => updatePrivacySettings({ relockAfterMs: relockFromValue(value) })}
        />
      ) : null}
    </>
  );
}
