// The soft "a new version is out" banner above the chat list (audit "remote-config-restart-bound": the only way to
// move people to a new build was the blocking gate). Shown when the server recommends a version above the running one
// (recommended_mobile_version, data/remote-config.ts) and this platform's store has it; "Update" opens the store,
// "Not now" hides it until the server recommends a newer one (data/release/update-nudge.ts). Never with the gate up:
// below the minimum, components/app/update-gate.tsx is the whole app.
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { buildInfo } from "@/data/build-info";
import { dismissNudge, readDismissedNudge } from "@/data/release/update-nudge";
import { useRemoteConfig } from "@/data/remote-config";
import { bestEffort } from "@/data/report";
import { updateNudgeFor } from "@/lib/build-info";
import { hitSlopFor } from "@/lib/platform-ui";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";

/** The close button's drawn size; its touch area reaches the platform minimum through hitSlop. */
const CLOSE_SIZE = 28;

export function UpdateNudge() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const { data } = useRemoteConfig();
  // undefined until the device store answers: the banner never flashes for a version already dismissed.
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    readDismissedNudge()
      .then((value) => live && setDismissed(value))
      .catch(bestEffort("update-nudge", "dismissed version not read", "breadcrumb"));
    return () => {
      live = false;
    };
  }, []);
  if (!data || dismissed === undefined) return null;
  const target = updateNudgeFor({ version: buildInfo().version, minimum: data.minSupportedVersion, recommended: data.recommendedVersion, dismissed });
  const storeUrl = Platform.OS === "ios" ? data.storeUrl.ios : data.storeUrl.android;
  if (!target || !storeUrl) return null;
  const dismiss = () => {
    setDismissed(target);
    void dismissNudge(target).catch(bestEffort("update-nudge", "dismissed version not kept", "breadcrumb"));
  };
  return (
    <View
      testID="update-nudge"
      className="mx-4 mb-1.5 mt-1 flex-row items-center gap-3 rounded-[14px] border border-primary/25 bg-tint-blue py-2.5 pl-3 pr-2"
      style={continuousCorners}
    >
      <TintTile tint="blue" icon="arrow-down-circle-outline" size={34} iconSize={17} />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${t("mobile.update.nudge_title", { version: target })}, ${t("mobile.update.nudge_body")}`}
        accessibilityHint={t("mobile.update.open_store")}
        onPress={() => void Linking.openURL(storeUrl)}
        className="flex-1 active:opacity-80"
      >
        <Text className="text-callout font-display font-bold text-foreground">{t("mobile.update.nudge_title", { version: target })}</Text>
        <Text className="text-footnote text-muted-foreground">{t("mobile.update.nudge_body")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.update.nudge_dismiss")}
        onPress={dismiss}
        hitSlop={hitSlopFor(CLOSE_SIZE, Platform.OS)}
        style={{ width: CLOSE_SIZE, height: CLOSE_SIZE }}
        className="items-center justify-center rounded-full active:bg-secondary"
      >
        <Ionicons name="close" size={18} color={THEME[colorScheme].mutedForeground} />
      </Pressable>
    </View>
  );
}
