// The canvas's search field (MobileList, MobNewChat, MobChannels, MobRoomInfo):
// a magnifier and the input on a rounded muted pill. Props go to the input.
import { Ionicons } from "@expo/vector-icons";
import type { Ref } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

export function SearchField({ className, ref, ...input }: TextInputProps & { className?: string; ref?: Ref<TextInput> }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className={cn("h-11 flex-row items-center gap-2 rounded-xl bg-muted px-3", className)}>
      <Ionicons name="search" size={18} color={theme.mutedForeground} />
      <TextInput
        ref={ref}
        placeholderTextColor={theme.mutedForeground}
        autoCorrect={false}
        clearButtonMode="while-editing"
        className="h-full flex-1 text-base text-foreground"
        {...input}
      />
    </View>
  );
}
