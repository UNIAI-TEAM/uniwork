// One message in a conversation (spec §2.2; canvas MobileChat): the bubble on
// the chat wall (mine on the right in brand, others in the card colour with a
// light shadow), shaped by its place in a run of one sender's bubbles; the
// sender's name inside the first bubble of a run in a group, the quoted
// message it answers, its content by kind, time / "Đã sửa" / the seen ticks or
// a local message's send state at the bubble's foot, reaction pills, the tasks
// made from it (M3) and the thread link.
import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { bubbleCorners } from "@/lib/conversation-display";
import { deserializeMessageBodyToComposerDraft } from "@/lib/mentions";
import { messagePreviewText, messageView } from "@/lib/message-display";
import { THEME } from "@/lib/theme";
import { formatMessageTime, type TimelineMessage } from "@/lib/timeline-display";
import { cn } from "@/lib/utils";
import { INTERACTIVE_VIEWS, MessageContent, type MessageCardContext } from "./message-cards";
import { TaskCards } from "./task-card";

export interface MessageRowProps {
  message: TimelineMessage;
  own: boolean;
  compactTop: boolean;
  /** The next message continues this run: no tail on this bubble. */
  continued: boolean;
  /** Who sent it ("Bạn" for mine), read out by VoiceOver/TalkBack. */
  senderName: string;
  /** Print the name in the bubble (a group's first bubble of a run). */
  showSender: boolean;
  quote: { sender: string; text: string; id: string } | null;
  seen: boolean;
  highlighted: boolean;
  /** Thread replies are off in a thread itself. */
  showThread: boolean;
  ctx: MessageCardContext;
  scheme: "light" | "dark";
  /** The tasks this message was turned into (its task links). */
  taskIds?: readonly string[];
  onLongPress: (message: TimelineMessage) => void;
  onPressQuote: (messageId: string) => void;
  onPressThread: (message: TimelineMessage) => void;
  onPressPending: (message: TimelineMessage) => void;
  onToggleReaction: (message: TimelineMessage, emoji: string) => void;
}

/** A local message's state where a sent one has its time: sending, waiting for the network, or failed. */
function PendingMeta({ message, scheme }: { message: TimelineMessage; scheme: "light" | "dark" }) {
  const { t } = useTranslation();
  const theme = THEME[scheme];
  const failed = message.pending!.status === "failed";
  const status = failed ? t("chat.send_failed") : message.pending!.status === "queued" ? t("chat.mobile.send_queued") : t("chat.mobile.send_sending");
  return (
    <>
      <Ionicons name={failed ? "alert-circle" : "time-outline"} size={13} color={failed ? theme.chatBubbleOwnForeground : theme.chatBubbleOwnMeta} />
      <Text className={cn("text-[11px]", failed ? "font-semibold text-chat-bubble-own-foreground" : "text-chat-bubble-own-meta")}>{status}</Text>
    </>
  );
}

export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  const { message, own, compactTop, continued, senderName, showSender, quote, seen, highlighted, showThread, ctx, scheme } = props;
  const { t, i18n } = useTranslation();
  const theme = THEME[scheme];
  const record = message.record;
  const time = formatMessageTime(message.ts, i18n.language);

  if (record && messageView(record) === "system") {
    return (
      <View className="items-center px-6 py-1.5" accessible accessibilityLabel={record.body}>
        <View className="rounded-xl bg-chat-chip px-3 py-1">
          <Text className="text-center text-[13px] text-chat-chip-foreground">{deserializeMessageBodyToComposerDraft(record.body)}</Text>
        </View>
      </View>
    );
  }

  // A call log is a chip on the wall that prints its own time: no bubble, no second time line.
  if (record && messageView(record) === "call-log") {
    return (
      <View className="items-center px-6 py-1.5">
        <MessageContent record={record} own={own} ctx={ctx} onLongPress={() => props.onLongPress(message)} />
      </View>
    );
  }

  const interactive = record ? INTERACTIVE_VIEWS.has(messageView(record)) : false;
  const preview = record ? messagePreviewText(record, t) : message.body;
  const longPress = () => props.onLongPress(message);
  const reactions = Object.entries(record?.reactions ?? {}).filter(([, count]) => count > 0);
  const mine = new Set(record?.my_reactions ?? []);
  const meta = own ? "text-chat-bubble-own-meta" : "text-muted-foreground";
  // The canvas lifts the incoming bubble off the light wall; the dark wall needs no shadow.
  const lift = own || scheme === "dark" ? null : { shadowColor: theme.foreground, shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 };

  return (
    <View className={cn("px-2.5", compactTop ? "pt-0.5" : "pt-2.5", own ? "items-end" : "items-start", highlighted && "bg-primary/10")}>
      <Pressable
        // A card with its own button, or a quote that jumps, stays reachable on its own.
        accessible={!interactive && !quote}
        accessibilityLabel={`${t("chat.message_list.label", { sender: senderName, time })}. ${preview}`}
        accessibilityActions={[{ name: "longpress", label: t("chat.message_actions_aria") }]}
        onAccessibilityAction={longPress}
        onLongPress={longPress}
        onPress={message.pending ? () => props.onPressPending(message) : undefined}
        delayLongPress={300}
        className={cn("gap-1 px-3 pb-2 pt-1.5", own ? "max-w-[82%] bg-chat-bubble-own" : "max-w-[80%] bg-chat-bubble-other")}
        style={[bubbleCorners(own, !compactTop, !continued), lift]}
      >
        {showSender ? (
          <Text className="text-[13px] font-semibold text-primary" numberOfLines={1}>
            {senderName}
          </Text>
        ) : null}
        {quote ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.reply_quote_jump", { preview: quote.text })}
            hitSlop={8}
            onPress={() => props.onPressQuote(quote.id)}
            className={cn("rounded-[10px] border-l-[3px] px-2 py-1", own ? "border-chat-bubble-own-foreground bg-chat-bubble-own-foreground/15" : "border-primary bg-tint-blue")}
          >
            <Text className={cn("text-[13px] font-semibold", own ? "text-chat-bubble-own-foreground" : "text-primary")} numberOfLines={1}>
              {quote.sender}
            </Text>
            <Text className={cn("text-[13px]", own ? "text-chat-bubble-own-foreground" : "text-muted-foreground")} numberOfLines={2}>
              {quote.text}
            </Text>
          </Pressable>
        ) : null}
        {record ? (
          <MessageContent record={record} own={own} ctx={ctx} onLongPress={longPress} />
        ) : (
          <Text className="text-base text-chat-bubble-own-foreground">
            {message.pending!.file ? message.pending!.file.name : deserializeMessageBodyToComposerDraft(message.pending!.body)}
          </Text>
        )}
        <View className="flex-row items-center gap-1 self-end">
          {record ? (
            <>
              <Text className={cn("text-[11px]", meta)}>{[record.edited_at ? t("chat.edited_label") : null, time].filter(Boolean).join(" · ")}</Text>
              {seen ? <Ionicons name="checkmark-done" size={15} color={theme.chatBubbleOwnMeta} accessibilityLabel={t("chat.read_receipt")} /> : null}
            </>
          ) : (
            <PendingMeta message={message} scheme={scheme} />
          )}
        </View>
      </Pressable>
      {reactions.length > 0 ? (
        <View className={cn("mt-1 flex-row flex-wrap gap-1", own ? "justify-end" : "justify-start")}>
          {reactions.map(([emoji, count]) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={t(mine.has(emoji) ? "chat.message_list.reaction_mine_aria" : "chat.message_list.reaction_aria", { emoji, count })}
              accessibilityState={{ selected: mine.has(emoji) }}
              // 30 pt pill, 44 pt target.
              hitSlop={7}
              onPress={() => props.onToggleReaction(message, emoji)}
              className={cn("h-[30px] flex-row items-center gap-1 rounded-full border px-2.5", mine.has(emoji) ? "border-primary bg-tint-blue" : "border-border bg-chat-bubble-other")}
            >
              <Text className="text-sm">{emoji}</Text>
              <Text className={cn("text-[13px] font-semibold", mine.has(emoji) ? "text-primary" : "text-muted-foreground")}>{count}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {props.taskIds?.length ? <TaskCards ctx={ctx} taskIds={props.taskIds} own={own} /> : null}
      {showThread && record && record.reply_count > 0 ? (
        <Pressable
          accessibilityRole="button"
          // 32 pt pill, 44 pt target.
          hitSlop={6}
          onPress={() => props.onPressThread(message)}
          className="mt-1 min-h-8 flex-row items-center gap-1.5 rounded-full bg-chat-chip px-3"
        >
          <Ionicons name="chatbubbles-outline" size={15} color={theme.primary} />
          <Text className="text-[13px] font-semibold text-primary">
            {t(record.thread_unread ? "chat.thread_replies_unread" : "chat.thread_replies", { count: record.reply_count })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});
