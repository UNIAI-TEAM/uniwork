// "Tin ghim i/n" under a conversation's header (MobileChat board), from the
// pinned messages among the loaded ones, newest first, the way the web's
// chat-pinned-messages-bar.tsx reads them: a tap jumps to the shown pin and
// moves on to the next older one.
import { Ionicons } from "@expo/vector-icons";
import { comparePinnedMessages } from "@uniwork/core/chat/pin-utils";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { messagePreviewText } from "@/lib/message-display";
import { THEME } from "@/lib/theme";
import type { TimelineMessage } from "@/lib/timeline-display";
import { useColorScheme } from "@/components/ui/use-color-scheme";

export function PinnedBar({ messages, onJump }: { messages: readonly TimelineMessage[]; onJump: (messageId: string) => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [cursor, setCursor] = useState(0);
  const pinned = useMemo(
    () =>
      messages
        .flatMap((m) => (m.record?.pinned ? [{ id: m.id, record: m.record }] : []))
        .sort((a, b) => comparePinnedMessages(a.record, b.record))
        .map(({ id, record }) => ({ id, preview: messagePreviewText(record, t) })),
    [messages, t],
  );
  const pinnedKey = pinned.map((row) => row.id).join(",");
  useEffect(() => {
    setCursor(0);
  }, [pinnedKey]);
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
        <Text className="text-caption font-semibold text-primary">{t("chat.mobile.pinned_bar", { index: position + 1, total: pinned.length })}</Text>
        <Text className="text-footnote text-foreground" numberOfLines={1}>
          {item.preview}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}
