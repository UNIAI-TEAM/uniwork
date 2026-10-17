// One message in a conversation (spec §2.2): the bubble (mine on the right),
// the sender's name over the first bubble of a run in a group, the quoted
// message it answers, its content by kind, time / "Đã sửa" / "Đã xem", the
// send state of a local message, reaction chips and the thread link.
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { deserializeMessageBodyToComposerDraft } from "@/lib/mentions";
import { messagePreviewText, messageView } from "@/lib/message-display";
import { formatMessageTime, type TimelineMessage } from "@/lib/timeline-display";
import { cn } from "@/lib/utils";
import { INTERACTIVE_VIEWS, MessageContent, type MessageCardContext } from "./message-cards";

export interface MessageRowProps {
  message: TimelineMessage;
  own: boolean;
  compactTop: boolean;
  /** Who sent it ("Bạn" for mine), read out by VoiceOver/TalkBack. */
  senderName: string;
  /** Print the name over the bubble (a group's first bubble of a run). */
  showSender: boolean;
  quote: { sender: string; text: string; id: string } | null;
  seen: boolean;
  highlighted: boolean;
  /** Thread replies are off in a thread itself. */
  showThread: boolean;
  ctx: MessageCardContext;
  onLongPress: (message: TimelineMessage) => void;
  onPressQuote: (messageId: string) => void;
  onPressThread: (message: TimelineMessage) => void;
  onPressPending: (message: TimelineMessage) => void;
  onToggleReaction: (message: TimelineMessage, emoji: string) => void;
}

function PendingContent({ message }: { message: TimelineMessage }) {
  const { t } = useTranslation();
  const pending = message.pending!;
  const status =
    pending.status === "failed" ? t("chat.send_failed") : pending.status === "queued" ? t("chat.mobile.send_queued") : t("chat.mobile.send_sending");
  return (
    <View className="gap-1">
      <Text className="text-base text-primary-foreground">{pending.file ? pending.file.name : deserializeMessageBodyToComposerDraft(pending.body)}</Text>
      <Text className={cn("text-xs", pending.status === "failed" ? "text-primary-foreground font-semibold" : "text-primary-foreground/80")}>{status}</Text>
    </View>
  );
}

export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  const { message, own, compactTop, senderName, showSender, quote, seen, highlighted, showThread, ctx } = props;
  const { t, i18n } = useTranslation();
  const record = message.record;
  const time = formatMessageTime(message.ts, i18n.language);

  if (record && messageView(record) === "system") {
    return (
      <View className="items-center px-6 py-2" accessible accessibilityLabel={record.body}>
        <Text className="text-xs text-muted-foreground text-center">{deserializeMessageBodyToComposerDraft(record.body)}</Text>
      </View>
    );
  }

  const interactive = record ? INTERACTIVE_VIEWS.has(messageView(record)) : false;
  const preview = record ? messagePreviewText(record, t) : message.body;
  const longPress = () => props.onLongPress(message);
  const reactions = Object.entries(record?.reactions ?? {}).filter(([, count]) => count > 0);
  const mine = new Set(record?.my_reactions ?? []);

  return (
    <View className={cn("px-3", compactTop ? "pt-0.5" : "pt-2", own ? "items-end" : "items-start", highlighted && "bg-secondary")}>
      {showSender ? <Text className="mb-0.5 ml-3 text-xs font-semibold text-muted-foreground">{senderName}</Text> : null}
      <Pressable
        // A card with its own button, or a quote that jumps, stays reachable on its own.
        accessible={!interactive && !quote}
        accessibilityLabel={`${t("chat.message_list.label", { sender: senderName, time })}. ${preview}`}
        accessibilityActions={[{ name: "longpress", label: t("chat.message_actions_aria") }]}
        onAccessibilityAction={longPress}
        onLongPress={longPress}
        onPress={message.pending ? () => props.onPressPending(message) : undefined}
        delayLongPress={300}
        className={cn("max-w-[85%] rounded-2xl px-3 py-2 gap-1", own ? "bg-primary rounded-br-md" : "bg-secondary rounded-bl-md")}
      >
        {quote ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.reply_quote_jump", { preview: quote.text })}
            hitSlop={8}
            onPress={() => props.onPressQuote(quote.id)}
            className={cn("border-l-2 pl-2", own ? "border-primary-foreground/60" : "border-primary")}
          >
            <Text className={cn("text-xs font-semibold", own ? "text-primary-foreground" : "text-primary")} numberOfLines={1}>
              {quote.sender}
            </Text>
            <Text className={cn("text-xs", own ? "text-primary-foreground/80" : "text-muted-foreground")} numberOfLines={2}>
              {quote.text}
            </Text>
          </Pressable>
        ) : null}
        {record ? <MessageContent record={record} own={own} ctx={ctx} onLongPress={longPress} /> : <PendingContent message={message} />}
        {record ? (
          <Text className={cn("self-end text-[11px]", own ? "text-primary-foreground/70" : "text-muted-foreground")}>
            {[record.edited_at ? t("chat.edited_label") : null, time, seen ? t("chat.read_receipt") : null].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </Pressable>
      {reactions.length > 0 ? (
        <View className={cn("mt-1 flex-row flex-wrap gap-1", own ? "justify-end" : "justify-start")}>
          {reactions.map(([emoji, count]) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={t(mine.has(emoji) ? "chat.message_list.reaction_mine_aria" : "chat.message_list.reaction_aria", { emoji, count })}
              // 32 px chip, 44 px target.
              hitSlop={6}
              onPress={() => props.onToggleReaction(message, emoji)}
              className={cn("min-h-8 flex-row items-center gap-1 rounded-full border px-2.5", mine.has(emoji) ? "border-primary bg-primary/10" : "border-border bg-background")}
            >
              <Text className="text-sm">{emoji}</Text>
              <Text className="text-xs text-muted-foreground">{count}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {showThread && record && record.reply_count > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => props.onPressThread(message)} className="min-h-11 justify-center px-2">
          <Text className="text-sm font-semibold text-primary">
            {t(record.thread_unread ? "chat.thread_replies_unread" : "chat.thread_replies", { count: record.reply_count })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});
