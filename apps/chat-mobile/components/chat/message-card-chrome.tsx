// The shared head of a message card: tinted tile, kind overline, ink for the
// bubble it sits in. Kept out of message-cards.tsx so that file stays within
// the line limit.
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import type { Tint } from "@/lib/tint";
import { cn } from "@/lib/utils";

/** The text classes of a card in the brand bubble (own) or the other bubble. */
export const ink = (own: boolean) => ({
  text: own ? "text-chat-bubble-own-foreground" : "text-foreground",
  meta: own ? "text-chat-bubble-own-meta" : "text-muted-foreground",
});

/** The head of a card: its tinted tile, the kind as an overline, and an optional pill. */
export function Card({
  own,
  tint,
  icon,
  kind,
  badge,
  children,
}: {
  own: boolean;
  tint: Tint;
  icon: keyof typeof Ionicons.glyphMap;
  kind: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View className="min-w-[230px] gap-1">
      <View className="mb-1 flex-row items-center gap-2.5">
        <TintTile tint={tint} icon={icon} size={28} iconSize={16} />
        <Text className={cn("flex-1 text-meta font-semibold uppercase tracking-wider", ink(own).meta)} numberOfLines={1}>
          {kind}
        </Text>
        {badge}
      </View>
      {children}
    </View>
  );
}
