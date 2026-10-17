/**
 * Mobile screen header — single row, slot-based, for tab roots.
 * Ported from usf apps/mobile/components/ui/header.tsx
 *
 * Rendered in the screen's JSX (NOT a react-navigation header), so dynamic
 * content reaches it as plain props. Self-handles the top safe area; colors
 * live on the tokens (`bg-background`, `text-foreground`, `border-border`)
 * so dark mode flips via NativeWind without any logic here.
 */
import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";

interface Props {
  title?: string;
  subtitle?: string;
  /** Centered custom node — wins over `title`. */
  center?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
}

export function Header({ title, subtitle, center, left, right }: Props) {
  return (
    <SafeAreaView edges={["top"]} className="bg-background border-b border-border">
      <View className="flex-row items-center h-12 px-2">
        {left ? <View className="flex-row items-center">{left}</View> : null}
        <View className="flex-1 px-2 justify-center">
          {center ??
            (title ? (
              <>
                <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </>
            ) : null)}
        </View>
        {right ? <View className="flex-row items-center gap-1">{right}</View> : null}
      </View>
    </SafeAreaView>
  );
}
