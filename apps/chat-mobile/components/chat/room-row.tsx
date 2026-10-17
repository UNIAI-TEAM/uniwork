// One conversation in the list (Telegram's row): mark, name, time, the last
// message or who is typing, the mute and pin marks, and the unread and
// mention badges with the web's rules (packages/views/chat/chat-sidebar-rows.tsx):
// a mention is "@", a count past 99 is "99+", a muted room keeps its counts
// but drops to neutral. One accessibility label reads the whole row.
import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import type { RoomMark } from "@/lib/room-list";
import { RoomAvatar } from "./room-avatar";

export interface RoomRowProps {
  title: string;
  mark: RoomMark;
  subtitle: string | null;
  typing: boolean;
  time: string | null;
  unread: number;
  mentionUnread: number;
  muted: boolean;
  pinned: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /** For the Maestro flows (apps/chat-mobile/maestro): `room-row-<roomId>`. */
  testID?: string;
}

export const RoomRow = memo(function RoomRow(props: RoomRowProps) {
  const { title, mark, subtitle, typing, time, unread, mentionUnread, muted, pinned, onPress, onLongPress, testID } = props;
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const hasUnread = unread > 0 || mentionUnread > 0;
  const label = [
    title,
    subtitle,
    time,
    mentionUnread > 0 ? t("chat.mention_unread_badge_aria", { count: mentionUnread }) : null,
    unread > 0 ? t("chat.unread_badge_aria", { count: unread }) : null,
    muted ? t("chat.sidebar_conversation_muted_aria") : null,
    pinned ? t("chat.sidebar_conversation_pinned_aria") : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={[{ name: "longpress", label: t("chat.settings_manage_room") }]}
      onAccessibilityAction={onLongPress}
      testID={testID}
      className="flex-row items-center gap-3 px-4 py-2.5 min-h-[72px] active:bg-secondary"
    >
      <RoomAvatar mark={mark} />
      <View className="flex-1 min-w-0 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Text className={cn("flex-1 text-base text-foreground", hasUnread ? "font-semibold" : "font-medium")} numberOfLines={1}>
            {title}
          </Text>
          {muted ? <Ionicons name="notifications-off-outline" size={14} color={theme.mutedForeground} /> : null}
          {time ? (
            <Text className={cn("text-xs", hasUnread && !muted ? "text-primary font-medium" : "text-muted-foreground")}>{time}</Text>
          ) : null}
        </View>
        <View className="flex-row items-center gap-2">
          <Text
            className={cn(
              "flex-1 text-sm",
              typing ? "italic text-primary" : hasUnread ? "text-foreground" : "text-muted-foreground",
            )}
            numberOfLines={1}
          >
            {subtitle ?? " "}
          </Text>
          {pinned && !hasUnread ? <Ionicons name="pin-outline" size={14} color={theme.mutedForeground} /> : null}
          {mentionUnread > 0 ? (
            <View className="h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5">
              <Text className="text-xs font-semibold text-primary-foreground">@</Text>
            </View>
          ) : null}
          {unread > 0 ? (
            <View
              className={cn(
                "h-5 min-w-5 items-center justify-center rounded-full px-1.5",
                muted ? "border border-border bg-background" : "bg-primary",
              )}
            >
              <Text className={cn("text-xs font-semibold", muted ? "text-muted-foreground" : "text-primary-foreground")}>
                {unread > 99 ? "99+" : String(unread)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});
