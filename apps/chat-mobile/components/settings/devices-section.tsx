// Settings › devices: every live native sign-in of the account, this one
// marked, the others revocable after a confirm. A revoked device is signed out
// by the server within a minute (data/queries/devices.ts).
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { devicesOptions, revokeDevice, type Device } from "@/data/queries/devices";
import { formatCallTime } from "@/lib/call-log-display";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { SettingsSection } from "./settings-section";

const PLATFORM_NAMES: Record<string, string> = { ios: "iOS", android: "Android", macos: "macOS", darwin: "macOS", windows: "Windows", linux: "Linux" };

function DeviceRow({ device, onRevoke }: { device: Device; onRevoke: (name: string) => void }) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const name = device.device_label.trim() || t("mobile.settings.unnamed_device");
  const phone = device.platform === "ios" || device.platform === "android";
  const detail = device.current
    ? t("mobile.settings.this_device")
    : [PLATFORM_NAMES[device.platform] ?? device.platform, formatCallTime(device.last_used_at, i18n.language)].filter(Boolean).join(" · ");
  return (
    <View className="min-h-[56px] flex-row items-center gap-3 px-4 py-2">
      <Ionicons name={phone ? "phone-portrait-outline" : "laptop-outline"} size={22} color={THEME[colorScheme].mutedForeground} />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base text-foreground">
          {name}
        </Text>
        <Text numberOfLines={1} className={device.current ? "text-sm font-medium text-primary" : "text-sm text-muted-foreground"}>
          {detail}
        </Text>
      </View>
      {device.current ? null : (
        <Button variant="ghost" size="sm" onPress={() => onRevoke(name)} accessibilityLabel={`${t("settings.security.sessions.revoke")} ${name}`}>
          <Text className="text-destructive">{t("settings.security.sessions.revoke")}</Text>
        </Button>
      )}
    </View>
  );
}

export function DevicesSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const devices = useQuery(devicesOptions());
  const revoke = useMutation({
    mutationFn: revokeDevice,
    onSettled: () => queryClient.invalidateQueries({ queryKey: devicesOptions().queryKey }),
    onError: () => Alert.alert(t("settings.security.sessions.revokeFailed")),
  });

  const confirm = (device: Device, name: string) =>
    Alert.alert(t("mobile.settings.revoke_title", { device: name }), t("mobile.settings.revoke_body"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("settings.security.sessions.revoke"), style: "destructive", onPress: () => revoke.mutate(device.id) },
    ]);

  return (
    <SettingsSection title={t("mobile.settings.devices")} hint={t("mobile.settings.devices_hint")}>
      {devices.isPending ? (
        <ActivityIndicator className="py-4" />
      ) : devices.isError ? (
        <Text className="px-4 py-3 text-sm text-destructive">{t("common.error")}</Text>
      ) : (
        devices.data.map((device, index) => (
          <View key={device.id}>
            {index > 0 ? <Separator /> : null}
            <DeviceRow device={device} onRevoke={(name) => confirm(device, name)} />
          </View>
        ))
      )}
    </SettingsSection>
  );
}
