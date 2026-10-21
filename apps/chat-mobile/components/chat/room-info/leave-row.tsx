// Leaving a conversation from its details: confirmed first (a DM and a group
// are told different consequences), then the whole stack closes; a refusal is
// a toast. Moved out of the route file, which only composes.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Alert, Pressable } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { toast } from "@/data/stores/toast-store";
import { THEME } from "@/lib/theme";

export function LeaveRoomRow({ dm, onLeave }: { dm: boolean; onLeave: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const leave = () =>
    Alert.alert(t("chat.leave_conversation_confirm_title"), dm ? t("chat.leave_conversation_confirm_description_dm") : t("chat.leave_conversation_confirm_description_group"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.leave_conversation"),
        style: "destructive",
        onPress: () =>
          void onLeave()
            .then(() => router.dismissAll())
            .catch(() => toast.error(t("chat.leave_conversation_failed"))),
      },
    ]);
  return (
    <Pressable accessibilityRole="button" onPress={leave} className="min-h-14 flex-row items-center gap-3 px-5 active:bg-secondary">
      <Ionicons name="exit-outline" size={22} color={THEME[colorScheme].destructive} />
      <Text className="text-body font-semibold text-destructive">{t("chat.leave_conversation")}</Text>
    </Pressable>
  );
}
