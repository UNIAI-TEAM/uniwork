// Settings › notifications on Android: what keeps a call from ringing once UniChat is closed, and the way to fix it
// (review "Calls, push & background": OEM background restrictions). Android's battery optimization or background
// restriction, when Android says one applies; and on Xiaomi, Oppo, realme, OnePlus, vivo, Huawei, Honor and Asus the
// vendor's autostart switch, which no vendor reports, so on those brands the way there is always here, with the
// vendor's own words. Both open the system page (modules/unichat-calls › BackgroundDelivery.kt) and are read again
// on the way back. Nothing shows on iOS, in a build without the native module, or while calling is switched off.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState } from "react-native";
import { Text } from "@/components/ui/text";
import { nativeCalls } from "@/data/calls/native-calls";
import { useMobileFlag } from "@/data/remote-config";
import { AUTOSTART_HINT_KEYS, backgroundCallsAdvice } from "@/lib/background-delivery";
import { SettingsRow } from "./settings-row";

export function BackgroundCallsRows() {
  const { t } = useTranslation();
  const callsOn = useMobileFlag("unichat_mobile_calls");
  const [advice, setAdvice] = useState(() => backgroundCallsAdvice(nativeCalls.backgroundDelivery()));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setAdvice(backgroundCallsAdvice(nativeCalls.backgroundDelivery()));
    });
    return () => sub.remove();
  }, []);

  if (!callsOn || !nativeCalls.available) return null;
  return (
    <>
      {advice.battery ? (
        <>
          <SettingsRow
            icon="battery-half-outline"
            label={t("mobile.notify.background_battery")}
            external
            testID="settings-background-battery"
            onPress={() => nativeCalls.openBatterySettings()}
          />
          <Text className="px-4 pb-3 text-callout text-muted-foreground">{t("mobile.notify.background_battery_hint")}</Text>
        </>
      ) : null}
      {advice.autostart ? (
        <>
          <SettingsRow
            icon="rocket-outline"
            label={t("mobile.notify.background_autostart")}
            external
            testID="settings-background-autostart"
            onPress={() => nativeCalls.openAutostartSettings()}
          />
          <Text className="px-4 pb-3 text-callout text-muted-foreground">{t(AUTOSTART_HINT_KEYS[advice.autostart])}</Text>
        </>
      ) : null}
    </>
  );
}
