// "Tin ghim i/n" under a conversation's header (MobileChat board), from the
// pinned messages among the loaded ones, newest first, the way the web's
// chat-pinned-messages-bar.tsx reads them: a tap jumps to the shown pin and
// moves on to the next older one.
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { messagePreviewText } from "@/lib/message-display";
import { THEME } from "@/lib/theme";
import type { TimelineMessage } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";

export function PinnedBar({ messages, onJump }: { messages: readonly TimelineMessage[]; onJump: (messageId: string) => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [cursor, setCursor] = useState(0);
  const pinned = useMemo(
    () =>
      messages
        .filter((m) => m.record?.pinned)
        .map((m) => ({ id: m.id, preview: m.record ? messagePreviewText(m.record, t) : m.body }))
        .reverse(),
    [messages, t],
  );
  const position = pinned.length > 0 ? cursor % pinned.length : 0;
  const item = pinned[position];
  if (!item) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("chat.mobile.pinned_bar", { index: position + 1, total: pinned.length })}. ${item.preview}`}
      onPress={() => {
        onJump(item.id);
        setCursor(position + 1);
      }}
      className="flex-row items-center gap-2.5 border-b border-border bg-background px-3 py-1.5 active:bg-secondary"
    >
      <TintTile tint="blue" icon="pin" size={30} iconSize={15} />
      <View className="flex-1">
        <Text className="text-xs font-semibold text-primary">{t("chat.mobile.pinned_bar", { index: position + 1, total: pinned.length })}</Text>
        <Text className="text-[13px] text-foreground" numberOfLines={1}>
          {item.preview}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}
