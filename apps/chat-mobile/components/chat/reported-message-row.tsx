// A message this person reported, in place of the bubble (Apple 1.2: the reporter stops seeing what they reported
// at once, while the operator reviews it; data/stores/reported-messages-store.ts keeps the list). One tap shows the
// message again for this run, so a report sent by mistake hides nothing for good.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useTapTarget } from "@/components/ui/tap-target";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { useReportedMessagesStore } from "@/data/stores/reported-messages-store";
import { THEME } from "@/lib/theme";

/** Whether a message is hidden from this person because they reported it (and have not chosen to see it again). */
export function useReportedHidden(messageId: string): boolean {
  return useReportedMessagesStore((state) => state.reported[messageId] !== undefined && !state.revealed[messageId]);
}

export function ReportedMessageRow({ messageId }: { messageId: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const reveal = useReportedMessagesStore((state) => state.reveal);
  const tap = useTapTarget(44);
  return (
    <View className="flex-row items-center gap-2 self-start px-3 py-1" testID={`reported-message-${messageId}`}>
      <View className="flex-row items-center gap-2 rounded-2xl bg-muted px-3.5 py-2">
        <Ionicons name="eye-off-outline" size={16} color={theme.mutedForeground} />
        <Text className="text-subhead text-muted-foreground">{t("mobile.report.hidden")}</Text>
      </View>
      <Pressable
        {...tap}
        accessibilityRole="button"
        accessibilityHint={t("mobile.report.show_hint")}
        onPress={() => reveal(messageId)}
        className="min-h-11 justify-center px-2 active:opacity-70"
      >
        <Text className="text-subhead font-semibold text-primary">{t("mobile.report.show")}</Text>
      </Pressable>
    </View>
  );
}
