// UniChat text-mark: a brand-coloured tile with the initial, no SVG (plan:
// the 1024² icon and a drawn logo land in M4).
import { View } from "react-native";
import { Text } from "@/components/ui/text";

export function UniChatLogo({ size = 56 }: { size?: number }) {
  return (
    <View className="items-center justify-center rounded-2xl bg-brand" style={{ width: size, height: size }}>
      <Text className="font-bold text-brand-foreground" style={{ fontSize: Math.round(size * 0.5) }}>
        U
      </Text>
    </View>
  );
}
