// The sheet that explains a permission before the system asks (data/permissions.ts):
// what UniChat needs, why, and when it is used; "Continue" lets the system show its
// prompt, "Not now" keeps it for later. When the system will not ask again it says the
// permission is off and offers the phone's Settings.
// Mounted once at the root; iOS will not present the system prompt over a
// sheet still closing, so the answer goes out once the sheet is gone.
import type { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useAfterDismiss } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import type { PermissionKind, PrimerRequest } from "@/data/permissions";
import { answerPrimer, usePrimerStore } from "@/data/stores/permission-primer-store";

const ICON: Record<PermissionKind, keyof typeof Ionicons.glyphMap> = {
  microphone: "mic-outline",
  camera: "videocam-outline",
  notifications: "notifications-outline",
};

function bodyKey({ kind, reason, step }: PrimerRequest): string {
  if (step === "settings") return `mobile.permissions.${kind}_denied`;
  if (kind === "microphone") return reason === "voice" ? "mobile.permissions.microphone_voice_body" : "mobile.permissions.microphone_call_body";
  return `mobile.permissions.${kind}_body`;
}

export function PermissionPrimerHost() {
  const { t } = useTranslation();
  const request = usePrimerStore((s) => s.request);
  const [closing, setClosing] = useState(false);
  useEffect(() => setClosing(false), [request]);
  const { choose, onDismiss } = useAfterDismiss(() => setClosing(true));
  if (!request) return null;
  const settings = request.step === "settings";
  const decline = () => choose(() => answerPrimer(false));
  return (
    // An ask for a call stays over that call's ringing screen: answering from the notification brings the app to the
    // front, the call rings here meanwhile, and closing the primer then would answer without the microphone.
    <BottomSheet
      visible={!closing}
      onClose={decline}
      onDismiss={onDismiss}
      keepOpenForCall={request.callId}
      backdropCloses={false}
      className="px-5 pb-3"
    >
      <View className="items-center gap-3 pb-5 pt-2">
        <TintTile tint="blue" icon={ICON[request.kind]} size={64} iconSize={30} className="rounded-full" />
        <Text className="text-center text-title2 font-display font-bold text-foreground" accessibilityRole="header">
          {t(`mobile.permissions.${request.kind}_title`)}
        </Text>
        <Text className="text-center text-body leading-6 text-muted-foreground">{t(bodyKey(request))}</Text>
      </View>
      <View className="gap-2.5">
        <Pressable
          accessibilityRole="button"
          testID="permission-primer-continue"
          onPress={() => choose(() => answerPrimer(true))}
          className="min-h-12 items-center justify-center rounded-full bg-primary px-4 py-3 active:opacity-90"
        >
          <Text className="text-body font-semibold text-primary-foreground">
            {t(settings ? "mobile.permissions.open_settings" : "mobile.permissions.continue")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          testID="permission-primer-later"
          onPress={decline}
          className="min-h-12 items-center justify-center rounded-full bg-muted px-4 py-3 active:opacity-70"
        >
          <Text className="text-body font-semibold text-foreground">{t("mobile.permissions.not_now")}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
