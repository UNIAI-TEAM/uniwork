// One titled group of the settings tab (canvas MobSettings): the caption above
// a rounded card on the grouped background, and an optional hint under it.
import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { continuousCorners } from "@/lib/radius";

export function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl bg-card" style={continuousCorners}>
        {children}
      </View>
      {hint ? <Text className="px-1 text-[13px] leading-[18px] text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}
