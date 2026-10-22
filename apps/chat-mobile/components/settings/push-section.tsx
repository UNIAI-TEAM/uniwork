// Settings › notifications: push on or off for this device. Off revokes the
// device's subscription on the server before the switch moves
// (useSetPushEnabled over data/push.ts › setPushEnabled); the hint states the
// server's rule that a person active elsewhere gets no push here. Below it, on Android 14+, the full-screen
// calls permission when it has been taken away (full-screen-calls-row.tsx).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useAnnounce } from "@/components/ui/a11y";
import { permissionGate } from "@/components/ui/permission-gate";
import { TintTile } from "@/components/ui/tint-tile";
import { useSetPushEnabled } from "@/data/mutations/push";
import { isPushEnabled } from "@/data/push";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { FullScreenCallsRow } from "./full-screen-calls-row";
import { SettingsSection } from "./settings-section";

export function PushSection() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const setPush = useSetPushEnabled();

  useEffect(() => {
    let live = true;
    void isPushEnabled().then((value) => {
      if (live) setEnabled(value);
    });
    return () => {
      live = false;
    };
  }, []);

  const onChange = async (next: boolean) => {
    // Turning it on here asks again, even after a "not now" at launch; a permission off for good offers Settings.
    const ask = () => permissionGate.ensure("notifications", "notifications");
    setBusy(true);
    setNotice(null);
    try {
      const token = await setPush.mutateAsync({ enabled: next, ask });
      if (next && !token) {
        // No permission (or no EAS build): nothing reaches this phone, so the switch says off.
        await setPush.mutateAsync({ enabled: false });
        setEnabled(false);
        setNotice("mobile.settings.push_unavailable");
      } else {
        setEnabled(next);
      }
    } catch {
      setEnabled(await isPushEnabled());
      setNotice("mobile.settings.push_failed");
    } finally {
      setBusy(false);
    }
  };

  // The notice's live region is TalkBack's; VoiceOver hears it through an announcement.
  useAnnounce(notice ? t(notice) : null);

  return (
    <SettingsSection title={t("settings.notifications.push_section")} hint={t("mobile.settings.push_hint")}>
      <View className="min-h-[60px] flex-row items-center gap-3 py-2 pl-4 pr-3.5">
        <TintTile tint="blue" icon="notifications-outline" size={36} iconSize={19} className="rounded-[10px]" />
        <Text className="flex-1 text-body text-foreground">{t("mobile.settings.push_this_device")}</Text>
        <Switch
          value={enabled ?? false}
          disabled={enabled === null || busy}
          onValueChange={(next) => void onChange(next)}
          trackColor={{ true: THEME[colorScheme].primary }}
          accessibilityLabel={t("mobile.settings.push_this_device")}
        />
      </View>
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="px-4 pb-3 text-callout text-destructive">
          {t(notice)}
        </Text>
      ) : null}
      <FullScreenCallsRow />
    </SettingsSection>
  );
}
