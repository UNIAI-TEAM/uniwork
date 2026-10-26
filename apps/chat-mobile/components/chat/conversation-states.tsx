// What a conversation shows before it has messages to draw, and when its
// history cannot be read: bubble
// shapes on the wall while the first page loads (the room's own outline, not a
// spinner), and "Couldn't load messages · Retry" when that page failed, never
// the "start chatting" copy of a room that really is empty, which would tell
// the reader their history is gone. Older pages that fail to load say so at
// the top of the list with their own retry.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { bubbleCorners } from "@/lib/conversation-display";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** [own, width, lines], newest last as on screen: the outline of a conversation, roughly. */
const SKELETON_BUBBLES: [boolean, number, number][] = [
  [false, 210, 2],
  [false, 150, 1],
  [true, 190, 1],
  [false, 240, 3],
  [true, 120, 1],
  [true, 220, 2],
  [false, 170, 1],
];

/** The first page on its way: grey bubbles where the messages will be, read as one "Loading…" element. */
export function ConversationSkeleton() {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("common.loading")}
      testID="conversation-skeleton"
      className="flex-1 justify-end gap-2 overflow-hidden px-2.5 pb-4"
    >
      {SKELETON_BUBBLES.map(([own, width, lines], index) => (
        <View
          key={index}
          className={cn("gap-1.5 px-3 py-2.5", own ? "self-end bg-chat-bubble-own/30" : "self-start bg-chat-bubble-other")}
          style={[bubbleCorners(own, true, true), { width }]}
        >
          {Array.from({ length: lines }, (_, line) => (
            <View
              key={line}
              className={cn("rounded-full", own ? "bg-chat-bubble-own/40" : "bg-muted")}
              style={{ height: 10, width: line === lines - 1 && lines > 1 ? "60%" : "100%" }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** The first page failed (after its retries): say so on the wall, with a retry, instead of the empty-room copy. */
export function ConversationLoadError({ thread, onRetry }: { thread: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="flex-1 items-center justify-center px-8" testID="conversation-load-error">
      <View accessibilityRole="alert" className="items-center gap-2 rounded-2xl bg-chat-chip px-5 py-4">
        <Ionicons name="cloud-offline-outline" size={28} color={theme.chatChipForeground} />
        <Text className="text-center text-headline font-display font-bold text-chat-chip-foreground">
          {t(thread ? "mobile.conversation.thread_load_failed" : "mobile.conversation.load_failed")}
        </Text>
        <Text className="max-w-[280px] text-center text-callout text-chat-chip-foreground">{t("mobile.conversation.load_failed_hint")}</Text>
        <Pressable
          accessibilityRole="button"
          // The label, not the children: the icon's glyph is a character a screen reader would spell.
          accessibilityLabel={t("common.retry")}
          testID="conversation-retry"
          onPress={onRetry}
          className="mt-1 min-h-12 flex-row items-center gap-2 rounded-full bg-primary px-5 py-2.5 active:opacity-80"
        >
          <Ionicons name="refresh" size={18} color={theme.primaryForeground} />
          <Text className="text-subhead font-semibold text-primary-foreground">{t("common.retry")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Above the oldest loaded message: older pages on their way, or the retry when the last attempt failed. */
export function OlderPagesFooter({ loading, onRetry }: { loading: boolean; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (loading) return <ActivityIndicator className="py-4" accessibilityLabel={t("chat.loading_older")} />;
  if (!onRetry) return null;
  return (
    <View className="items-center py-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("mobile.conversation.older_load_failed")}. ${t("common.retry")}`}
        testID="conversation-older-retry"
        onPress={onRetry}
        className="min-h-11 flex-row items-center gap-1.5 rounded-full bg-chat-chip px-4 py-2 active:opacity-80"
      >
        <Text className="text-footnote text-chat-chip-foreground">{t("mobile.conversation.older_load_failed")}</Text>
        <Text className="text-footnote font-semibold text-primary">{t("common.retry")}</Text>
      </Pressable>
    </View>
  );
}
