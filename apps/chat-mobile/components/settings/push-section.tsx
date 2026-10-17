// Settings › notifications: push on or off for this device. Off revokes the
// device's subscription on the server before the switch moves (data/push.ts ›
// setPushEnabled); the hint states the server's rule that a person active
// elsewhere gets no push here.
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Switch, View } from "react-native";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { isPushEnabled, setPushEnabled } from "@/data/push";
import { easProjectId } from "@/lib/runtime-extra";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { SettingsSection } from "./settings-section";

export function PushSection() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    const options = { api, projectId: easProjectId(Constants.expoConfig?.extra), platform: Platform.OS };
    setBusy(true);
    setNotice(null);
    try {
      const token = await setPushEnabled(next, options);
      if (next && !token) {
        // No permission (or no EAS build): nothing reaches this phone, so the switch says off.
        await setPushEnabled(false, options);
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

  return (
    <SettingsSection title={t("settings.notifications.push_section")} hint={t("mobile.settings.push_hint")}>
      <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-2">
        <Text className="flex-1 text-base text-foreground">{t("mobile.settings.push_this_device")}</Text>
        <Switch
          value={enabled ?? false}
          disabled={enabled === null || busy}
          onValueChange={(next) => void onChange(next)}
          trackColor={{ true: THEME[colorScheme].primary }}
          accessibilityLabel={t("mobile.settings.push_this_device")}
        />
      </View>
      {notice ? (
        <Text accessibilityLiveRegion="polite" className="px-4 pb-3 text-sm text-destructive">
          {t(notice)}
        </Text>
      ) : null}
    </SettingsSection>
  );
}
