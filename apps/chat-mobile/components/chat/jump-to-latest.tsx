// The round button over the bottom of a conversation that is scrolled up
// (audit P2 UX; the web's ChatJumpToLatestButton): a chevron down and, when
// others wrote since the reader left the bottom, how many ("99+" past 99).
// The count is a badge, so its text stops growing with the system text size at the badge cap
// (lib/type-scale.ts); the button's label carries the full count either way.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { BADGE_MAX_FONT_SCALE } from "@/lib/type-scale";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export function JumpToLatest({ count, onPress }: { count: number; onPress: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} className="absolute bottom-3 right-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? t("chat.jump_latest_new", { count }) : t("chat.search_back_to_latest")}
        testID="jump-to-latest"
        onPress={onPress}
        className="h-11 w-11 items-center justify-center rounded-full border border-border bg-background shadow-md shadow-black/20 active:bg-secondary"
      >
        <Ionicons name="chevron-down" size={22} color={theme.foreground} />
        {count > 0 ? (
          <View className="absolute -top-2 min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5">
            <Text className="text-meta font-bold text-primary-foreground" maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}>
              {count > 99 ? "99+" : count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
