// One titled group of the settings tab: the caption above a bordered card, and
// an optional hint under it — the shape the M1 theme and language groups use.
import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";

export function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-1 text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-md border border-border bg-card">{children}</View>
      {hint ? <Text className="px-1 text-xs text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}
