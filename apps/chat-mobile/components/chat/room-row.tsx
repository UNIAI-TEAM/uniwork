// One conversation in the list (MobileList board): mark, name, time, the last
// message or who is typing, the mute and pin marks, and the unread and
// mention badges with the web's rules (packages/views/chat/chat-sidebar-rows.tsx):
// a mention is "@", a count past 99 is "99+", a muted room keeps its counts
// but drops to neutral. One accessibility label reads the whole row, and its
// actions run what the swipe does by touch (mark read, pin, mute) before the
// long-press menu.
import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { useLargeText } from "@/components/ui/a11y";
import { haptics } from "@/components/ui/haptics";
import { useRipple } from "@/components/ui/ripple";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";
import type { RoomMark } from "@/lib/room-list";
import { RoomAvatar } from "./room-avatar";
import { BADGE_MAX_FONT_SCALE } from "@/lib/type-scale";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** A command a screen reader runs from the row's actions (room-swipe.tsx does the same by touch). */
export interface RoomRowAction {
  name: string;
  label: string;
  run: () => void;
}

export interface RoomRowProps {
  title: string;
  mark: RoomMark;
  /** The room id the mark's tint is hashed from. */
  seed: string;
  prefix?: string | null;
  subtitle: string | null;
  typing: boolean;
  missed?: boolean;
  seen?: boolean;
  /** A message of this room waits in the send queue for the network. */
  queued?: boolean;
  /** What the person was writing here and did not send: "Nháp: …" in place of the last message. */
  draft?: string | null;
  time: string | null;
  unread: number;
  mentionUnread: number;
  muted: boolean;
  pinned: boolean;
  onPress: () => void;
  onLongPress: () => void;
  /** Named actions ahead of the menu, in order (mark read, pin, mute). */
  actions?: readonly RoomRowAction[];
  /** For the Maestro flows (apps/chat-mobile/maestro): `room-row-<roomId>`. */
  testID?: string;
}

export const RoomRow = memo(function RoomRow(props: RoomRowProps) {
  const {
    title,
    mark,
    seed,
    prefix,
    subtitle,
    typing,
    missed,
    seen,
    queued,
    draft,
    time,
    unread,
    mentionUnread,
    muted,
    pinned,
    onPress,
    onLongPress,
    actions,
    testID,
  } = props;
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const ripple = useRipple();
  // At the accessibility text sizes the name gets its own two lines and the marks and time wrap under it (Slack,
  // Messages): one line of "Ng…" beside a clock reads as nothing.
  const large = useLargeText();
  const hasUnread = unread > 0 || mentionUnread > 0;
  const label = [
    title,
    queued ? t("chat.mobile.send_queued") : draft ? `${t("chat.sidebar_draft_label")} ${draft}` : `${prefix ?? ""}${subtitle ?? ""}`,
    time,
    seen ? t("chat.sidebar_seen_aria") : null,
    mentionUnread > 0 ? t("chat.mention_unread_badge_aria", { count: mentionUnread }) : null,
    unread > 0 ? t("chat.unread_badge_aria", { count: unread }) : null,
    muted ? t("chat.sidebar_conversation_muted_aria") : null,
    pinned ? t("chat.sidebar_conversation_pinned_aria") : null,
  ]
    .filter(Boolean)
    .join(", ");

  const a11yActions = [
    ...(actions ?? []).map(({ name, label: actionLabel }) => ({ name, label: actionLabel })),
    { name: "longpress", label: t("chat.settings_manage_room") },
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={() => {
        // Felt as a message's long press is; the screen reader's action below needs no touch feedback.
        haptics.longPress();
        onLongPress();
      }}
      accessibilityActions={a11yActions}
      onAccessibilityAction={(event) => {
        const action = actions?.find(({ name }) => name === event.nativeEvent.actionName);
        if (action) action.run();
        else onLongPress();
      }}
      testID={testID}
      android_ripple={ripple}
      className="min-h-[76px] flex-row items-center gap-3 ps-4 active:bg-secondary"
    >
      <RoomAvatar mark={mark} seed={seed} />
      <View className="min-w-0 flex-1 self-stretch justify-center gap-[3px] border-b-hairline border-border py-2.5 pe-4">
        <View className={cn("flex-row items-center gap-1.5", large && "flex-wrap")}>
          <Text className={cn("text-body font-display font-bold text-foreground", large ? "w-full" : "flex-1")} numberOfLines={large ? 2 : 1}>
            {title}
          </Text>
          {muted ? <Ionicons name="notifications-off" size={14} color={theme.mutedForeground} /> : null}
          {seen ? <Ionicons name="checkmark-done" size={16} color={theme.primary} /> : null}
          {time ? (
            <Text className={cn("text-footnote", hasUnread && !muted ? "font-semibold text-primary" : "text-muted-foreground")} style={TABULAR}>
              {time}
            </Text>
          ) : null}
        </View>
        <View className={cn("flex-row items-center gap-1.5", large && "flex-wrap")}>
          {queued ? (
            <View className="flex-1 flex-row items-center gap-1.5">
              <Ionicons name="time-outline" size={14} color={theme.tintOrangeForeground} />
              <Text className="flex-1 text-subhead leading-5 text-tint-orange-foreground" numberOfLines={1}>
                {t("chat.mobile.send_queued")}
              </Text>
            </View>
          ) : draft ? (
            // WhatsApp's and the web's draft line: the label in red, then the words.
            <Text className={cn("text-subhead leading-5 text-muted-foreground", large ? "w-full" : "flex-1")} numberOfLines={large ? 2 : 1}>
              <Text className="text-subhead font-medium text-destructive">{t("chat.sidebar_draft_label")}</Text> {draft}
            </Text>
          ) : (
            <Text
              className={cn(
                "text-subhead leading-5",
                large ? "w-full" : "flex-1",
                typing ? "font-medium text-primary" : missed ? "text-destructive" : "text-muted-foreground",
              )}
              numberOfLines={large ? 2 : 1}
            >
              {prefix ? <Text className="text-subhead font-medium text-foreground">{prefix}</Text> : null}
              {subtitle ?? " "}
            </Text>
          )}
          {mentionUnread > 0 ? (
            <View className="min-h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary">
              <Text className="text-footnote font-display font-bold text-primary-foreground" maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}>
                @
              </Text>
            </View>
          ) : null}
          {unread > 0 ? (
            <View
              className={cn(
                "min-h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px]",
                muted ? "bg-muted-foreground" : "bg-primary",
              )}
            >
              <Text
                className={cn("text-caption font-semibold", muted ? "text-background" : "text-primary-foreground")}
                style={TABULAR}
                maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}
              >
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
