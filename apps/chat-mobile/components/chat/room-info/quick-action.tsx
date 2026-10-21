// A round quick action of a conversation's details (MobRoomInfo board): mute,
// search, call, add people. Moved out of the route file, which only composes.
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { THEME } from "@/lib/theme";

export function QuickAction(props: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; accessibilityLabel?: string; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      onPress={props.onPress}
      className="w-[84px] items-center gap-1.5 active:opacity-70"
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Ionicons name={props.icon} size={22} color={THEME[colorScheme].primary} />
      </View>
      <Text className="text-center text-caption font-semibold text-foreground" numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/** The grey band between the sections of the details screen. */
export const Divider = () => <View className="h-2 bg-muted" />;
