// Settings › notifications on Android 14+: a call rings full screen over a
// locked phone only while the app may use full-screen intents, a permission
// the person (or Play) can take away. When it is gone this row says so and
// opens the system page to give it back; it rechecks whenever the app comes
// back to the front. Nothing shows where the permission is not a thing, or
// while the calls switch (data/remote-config.ts) has calling off.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState } from "react-native";
import { Text } from "@/components/ui/text";
import { nativeCalls } from "@/data/calls/native-calls";
import { useMobileFlag } from "@/data/remote-config";
import { SettingsRow } from "./settings-row";

export function FullScreenCallsRow() {
  const { t } = useTranslation();
  const callsOn = useMobileFlag("unichat_mobile_calls");
  const [allowed, setAllowed] = useState(() => nativeCalls.canUseFullScreenIntent());

  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setAllowed(nativeCalls.canUseFullScreenIntent());
    });
    return () => sub.remove();
  }, []);

  if (allowed || !callsOn) return null;
  return (
    <>
      <SettingsRow
        icon="call-outline"
        label={t("mobile.notify.full_screen_calls")}
        external
        testID="settings-full-screen-calls"
        onPress={() => nativeCalls.openFullScreenIntentSettings()}
      />
      <Text className="px-4 pb-3 text-sm text-muted-foreground">{t("mobile.notify.full_screen_calls_hint")}</Text>
    </>
  );
}
