// One conversation in the list (MobileList board): mark, name, time, the last
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

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export interface RoomRowProps {
  title: string;
  mark: RoomMark;
  /** The room id the mark's tint is hashed from. */
  seed: string;
  subtitle: string | null;
  typing: boolean;
  time: string | null;
  unread: number;
  mentionUnread: number;
  muted: boolean;
  pinned: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export const RoomRow = memo(function RoomRow(props: RoomRowProps) {
  const { title, mark, seed, subtitle, typing, time, unread, mentionUnread, muted, pinned, onPress, onLongPress } = props;
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
      className="min-h-[76px] flex-row items-center gap-3 pl-4 active:bg-secondary"
    >
      <RoomAvatar mark={mark} seed={seed} />
      <View className="min-w-0 flex-1 self-stretch justify-center gap-[3px] border-b-hairline border-border py-2.5 pr-4">
        <View className="flex-row items-center gap-1.5">
          <Text className="flex-1 text-base font-bold text-foreground" numberOfLines={1}>
            {title}
          </Text>
          {muted ? <Ionicons name="notifications-off" size={14} color={theme.mutedForeground} /> : null}
          {time ? (
            <Text className={cn("text-[13px]", hasUnread && !muted ? "font-semibold text-primary" : "text-muted-foreground")} style={TABULAR}>
              {time}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text
            className={cn("flex-1 text-[15px] leading-5", typing ? "font-medium text-primary" : "text-muted-foreground")}
            numberOfLines={1}
          >
            {subtitle ?? " "}
          </Text>
          {mentionUnread > 0 ? (
            <View className="h-[22px] w-[22px] items-center justify-center rounded-full bg-primary">
              <Text className="text-[13px] font-bold text-primary-foreground">@</Text>
            </View>
          ) : null}
          {unread > 0 ? (
            <View
              className={cn(
                "h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px]",
                muted ? "bg-muted-foreground" : "bg-primary",
              )}
            >
              <Text className={cn("text-xs font-semibold", muted ? "text-background" : "text-primary-foreground")} style={TABULAR}>
                {unread > 99 ? "99+" : String(unread)}
              </Text>
            </View>
          ) : null}
          {pinned && !hasUnread ? <Ionicons name="pin" size={15} color={theme.mutedForeground} /> : null}
        </View>
      </View>
    </Pressable>
  );
});
