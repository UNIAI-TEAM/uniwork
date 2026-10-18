/**
 * Mobile screen header — slot-based, for tab roots and pushed screens.
 * Ported from usf apps/mobile/components/ui/header.tsx
 *
 * Rendered in the screen's JSX (NOT a react-navigation header), so dynamic
 * content reaches it as plain props. Self-handles the top safe area; colors
 * live on the tokens (`bg-background`, `text-foreground`, `border-border`)
 * so dark mode flips via NativeWind without any logic here.
 *
 * `large` is a tab root (MobileList board): the slots on one row, the title
 * large beneath them, then `children` (a search field) — no bottom rule.
 */
import type { ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";

interface Props {
  title?: string;
  subtitle?: string;
  /** Centered custom node — wins over `title` (compact only). */
  center?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  large?: boolean;
  /** Below the large title (large only). */
  children?: ReactNode;
}

export function Header({ title, subtitle, center, left, right, large = false, children }: Props) {
  if (large) {
    return (
      <SafeAreaView edges={["top"]} className="bg-background px-4 pt-2">
        {left || right ? (
          <View className="min-h-11 flex-row items-center gap-2">
            {left}
            <View className="flex-1" />
            {right}
          </View>
        ) : null}
        {title ? (
          <Text accessibilityRole="header" className="mt-3 text-[30px] font-extrabold leading-9 tracking-tight text-foreground" numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? <Text className="mt-0.5 text-sm text-muted-foreground">{subtitle}</Text> : null}
        {children}
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={["top"]} className="bg-background border-b border-border">
      <View className="flex-row items-center h-12 px-2">
        {left ? <View className="flex-row items-center">{left}</View> : null}
        <View className="flex-1 px-2 justify-center">
          {center ??
            (title ? (
              <>
                <Text accessibilityRole="header" className="text-lg font-bold text-foreground" numberOfLines={1}>
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
