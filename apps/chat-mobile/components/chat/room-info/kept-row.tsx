// The "pins, notes and polls" row of a conversation's details: how many the
// loaded messages hold; a tap opens the room, where the pinned bar is. Moved
// out of the route file, which only composes.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { THEME } from "@/lib/theme";

export function KeptRow({ kept, onPress }: { kept: { pins: number; notes: number; polls: number }; onPress: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="min-h-[60px] flex-row items-center gap-3 border-t-hairline border-border px-5 active:bg-secondary">
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-tint-yellow">
        <Ionicons name="pin-outline" size={20} color={theme.tintYellowForeground} />
      </View>
      <View className="flex-1">
        <Text className="text-subhead font-semibold text-foreground">{t("chat.mobile.shared_notes_row")}</Text>
        <Text className="text-footnote text-muted-foreground">{t("chat.mobile.shared_notes_counts", kept)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
    </Pressable>
  );
}
