// Settings › Privacy & security: lock UniChat behind Face ID, a fingerprint or
// the phone's passcode (and how long it may stay away before it locks again),
// and block screenshots and screen recording (audit "Security & privacy",
// no-app-switcher-privacy-or-lock). Turning the lock on asks for the owner's
// proof first, so nobody turns on a lock they cannot open; a phone with no
// screen lock at all says so instead. The choices are this phone's
// (components/app/privacy.ts), applied at once; the guard
// (components/app/privacy-guard.tsx) carries them out.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Switch, View } from "react-native";
import { useAnnounce } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { RELOCK_AFTER_MS, relockFromValue, relockLabel, type RelockAfterMs } from "@/lib/app-lock";
import type { Tint } from "@/lib/tint";
import { THEME } from "@/lib/theme";
import { authenticateOwner, deviceCanLock, updatePrivacySettings, usePrivacySettings } from "@/components/app/privacy";
import { OptionGroup, type Option } from "./option-group";
import { SettingsSection } from "./settings-section";

const RELOCK_OPTIONS: Option<`${RelockAfterMs}`>[] = RELOCK_AFTER_MS.map((ms) => ({ value: `${ms}`, label: relockLabel(ms) }));

function SwitchRow({
  icon,
  tint,
  label,
  hint,
  value,
  disabled,
  first,
  onChange,
}: {
  icon: Parameters<typeof TintTile>[0]["icon"];
  tint: Tint;
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  first?: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className={first ? "min-h-[60px] flex-row items-center gap-3 py-2 pl-4 pr-3.5" : "min-h-[60px] flex-row items-center gap-3 border-t-hairline border-border py-2 pl-4 pr-3.5"}>
      <TintTile tint={tint} icon={icon} size={36} iconSize={19} className="rounded-[10px]" />
      <View className="flex-1 gap-0.5 py-1">
        <Text className="text-body text-foreground">{label}</Text>
        <Text className="text-footnote text-muted-foreground">{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: THEME[colorScheme].primary }}
        accessibilityLabel={label}
        accessibilityHint={hint}
        // React Native's Switch does not tell assistive technology it is disabled.
        accessibilityState={{ disabled: !!disabled, checked: value }}
      />
    </View>
  );
}

export function PrivacySection({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { settings, loaded } = usePrivacySettings();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onAppLock = async (next: boolean) => {
    setNotice(null);
    if (!next) {
      updatePrivacySettings({ appLock: false });
      return;
    }
    setBusy(true);
    try {
      if (!(await deviceCanLock())) {
        setNotice("mobile.security.app_lock_unavailable");
        return;
      }
      if (await authenticateOwner(t("mobile.security.unlock_prompt"), t("common.cancel"))) updatePrivacySettings({ appLock: true });
    } finally {
      setBusy(false);
    }
  };

  // The notice's live region is TalkBack's; VoiceOver hears it through an announcement (audit U1).
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
          hint={t("mobile.security.app_lock_hint")}
          value={settings.appLock}
          disabled={!loaded || busy}
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
          hint={t("mobile.security.screen_security_hint")}
          value={settings.screenSecurity}
          disabled={!loaded}
          onChange={(next) => updatePrivacySettings({ screenSecurity: next })}
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
