// One message in a conversation (spec §2.2; canvas MobileChat): the bubble on
// the chat wall (mine on the right in brand, others in the card colour lifted off
// the light wall by a hairline or an elevation), shaped by its place in a run of one sender's bubbles; the
// sender's name inside the first bubble of a run in a group, the quoted
// message it answers, its content by kind, time / "Đã sửa" / the seen ticks or
// a local message's send state at the bubble's foot, reaction pills, the tasks
// made from it and the thread link. A screen reader hears one element per
// bubble: sender, time, the quote, the text, its state and its
// receipt, with actions for the menu and the quoted message, and a hint on a
// local message that its tap opens retry / delete.
import { Ionicons } from "@expo/vector-icons";
import { memo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Platform, Pressable, StyleSheet, View, type AccessibilityActionEvent } from "react-native";
import Animated, { FadeIn, LayoutAnimationConfig, ZoomIn } from "react-native-reanimated";
import { useRipple } from "@/components/ui/ripple";
import { useTapTarget } from "@/components/ui/tap-target";
import { Text } from "@/components/ui/text";
import { bubbleCorners } from "@/lib/conversation-display";
import { createFirstSight } from "@/lib/first-sight";
import { senderNameClass } from "@/lib/sender-colors";
import { deserializeMessageBodyToComposerDraft } from "@uniwork/core/chat/chat-mention-utils";
import { messagePreviewText, messageView, pendingPreviewText } from "@/lib/message-display";
import { messageLinks, spokenLink } from "@/lib/message-format";
import type { Receipt } from "@/lib/message-row-model";
import { THEME } from "@/lib/theme";
import type { PendingSend } from "@/lib/send-pipeline";
import { formatMessageTime, type TimelineMessage } from "@/lib/timeline-display";
import { cn } from "@/lib/utils";
import { AlbumGrid } from "./album-grid";
import { INTERACTIVE_VIEWS, MessageContent, type MessageCardContext } from "./message-cards";
import { TaskCards } from "./task-card";

/** A screen reader's actions name at most this many of a message's links (the menu would bury the rest). */
const MAX_LINK_ACTIONS = 5;

/** The design language board: a sent message appears in 180 ms; a reaction pops on a spring. */
const SEND_IN = FadeIn.duration(180);
const REACTION_IN = ZoomIn.springify().damping(14);
/** The sends whose bubble this process has drawn: one fades in once, not each time the list re-mounts its cell. */
const firstSend = createFirstSight(200);

/**
 * The canvas lifts the incoming bubble off the light wall; the dark wall needs no lift. Android draws it as an
 * elevation on the render thread; on iOS a shadow without a shadowPath is an offscreen pass per bubble, every frame of
 * a scroll, so a hairline of the border colour draws the edge instead. Static objects, not one per render.
 */
const LIFT_IOS = { borderWidth: StyleSheet.hairlineWidth, borderColor: THEME.light.border };
const LIFT_ANDROID = { shadowColor: THEME.light.foreground, elevation: 1 };

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
  /** A sent message's receipt at its foot: one tick, two ticks, then a filled double-tick badge once read. */
  receipt: Receipt | null;
  /** Beside someone else's bubble in a group: their avatar on the last of a run, a spacer on the others. */
  avatar?: ReactNode;
  /** The message a thread answers: a 2 pt brand ring around its bubble (MobThread board). */
  ringed?: boolean;
  /** Photos sent back to back with this one, drawn as one album bubble (this message first). */
  album?: readonly TimelineMessage[];
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

/** A local message's state in words: sending, waiting for the network, or failed. */
function pendingStatusText(status: NonNullable<TimelineMessage["pending"]>["status"], t: TFunction): string {
  return status === "failed" ? t("chat.send_failed") : status === "queued" ? t("chat.mobile.send_queued") : t("chat.mobile.send_sending");
}

/** What a sent message's ticks say to a screen reader. */
function receiptText(receipt: Receipt | null, t: TFunction): string | null {
  if (receipt === "seen") return t("chat.read_receipt");
  if (receipt === "delivered") return t("chat.receipt_delivered");
  return receipt === "sent" ? t("chat.receipt_sent") : null;
}

/** A local message's state where a sent one has its time. */
function PendingMeta({ pending, scheme }: { pending: PendingSend; scheme: "light" | "dark" }) {
  const { t } = useTranslation();
  const theme = THEME[scheme];
  const failed = pending.status === "failed";
  const status = pendingStatusText(pending.status, t);
  return (
    <>
      <Ionicons name={failed ? "alert-circle" : "time-outline"} size={13} color={failed ? theme.chatBubbleOwnForeground : theme.chatBubbleOwnMeta} />
      <Text className={cn("text-meta", failed ? "font-semibold text-chat-bubble-own-foreground" : "text-chat-bubble-own-meta")}>{status}</Text>
    </>
  );
}

export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  const { message, own, compactTop, continued, senderName, showSender, quote, receipt, avatar, album, ringed, highlighted, showThread, ctx, scheme } =
    props;
  const { t, i18n } = useTranslation();
  const theme = THEME[scheme];
  const record = message.record;
  const time = formatMessageTime(message.ts, i18n.language);
  // The platform's target and Android's ripple (lib/platform-ui.ts): 30 pt reaction pills that wrap side by side
  // grow up and down only; the 32 pt thread chip all round; the quote keeps its slop inside the bubble.
  const reactionTap = useTapTarget(30);
  const reactionSlop = { top: reactionTap.hitSlop, bottom: reactionTap.hitSlop };
  const threadTap = useTapTarget(32);
  const quoteRipple = useRipple();
  // Decided once per mount: a pending send seen for the first time fades in. Any other mount (a cell scrolled back
  // into the list's window, a remount after the send) skips its children's entering animations, so the reactions it
  // already has stand still; one added while the cell is on screen still pops (LayoutAnimationConfig skips only at mount).
  const [fresh] = useState(() => message.pending !== undefined && firstSend(message.id));

  if (record && messageView(record) === "system") {
    return (
      <View className="items-center px-6 py-1.5" accessible accessibilityLabel={record.body}>
        <View className="rounded-xl bg-chat-chip px-3 py-1">
          <Text className="text-center text-footnote text-chat-chip-foreground">{deserializeMessageBodyToComposerDraft(record.body)}</Text>
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

  const interactive = album ? true : record ? INTERACTIVE_VIEWS.has(messageView(record)) : false;
  const footTs = album?.at(-1)?.ts ?? message.ts;
  // A pending message has no record yet: its own text, with mentions as names, or its file's name.
  const preview = record ? messagePreviewText(record, t) : message.pending ? pendingPreviewText(message.pending, t) : "";
  // The bubble is one accessible element, so what its quote and foot show must be in its label too.
  const state = message.pending ? pendingStatusText(message.pending.status, t) : record?.edited_at ? t("chat.edited_label") : null;
  const receiptLabel = receiptText(receipt, t);
  const quoteLabel = quote ? t("mobile.a11y.bubble_quote", { sender: quote.sender, text: quote.text }) : null;
  const header = t("chat.message_list.label", { sender: senderName, time });
  const label = [header, quoteLabel, preview, state, receiptLabel].filter(Boolean).join(". ");
  // A local message's tap opens retry / delete (a sending one: delete only, as message-actions.tsx offers).
  const hint = message.pending
    ? t(message.pending.status === "sending" ? "mobile.a11y.bubble_sending_hint" : "mobile.a11y.bubble_retry_hint")
    : undefined;
  const longPress = () => props.onLongPress(message);
  // The links of a text message, each a screen-reader action that opens its open / copy / share sheet (link-sheet.tsx).
  const links = record && messageView(record) === "text" ? messageLinks(record.body).slice(0, MAX_LINK_ACTIONS) : [];
  // Every long-press action reachable without a long press: the menu, the quoted message and each link.
  const actions = [
    { name: "longpress", label: t("chat.message_actions_aria") },
    ...(quote ? [{ name: "open_quote", label: t("chat.reply_quote_jump", { preview: quote.text }) }] : []),
    ...links.map((url, index) => ({ name: `link_${index}`, label: t("mobile.conversation.link_label", { link: spokenLink(url) }) })),
  ];
  const onAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    const link = name.startsWith("link_") ? links[Number(name.slice(5))] : undefined;
    if (link) ctx.onLinkMenu(link);
    else if (name === "open_quote" && quote) props.onPressQuote(quote.id);
    else longPress();
  };
  // A card with its own buttons (a photo, a file, a poll…) keeps them reachable: the bubble is then not one element,
  // and its foot is read as one line of its own.
  const footLabel = interactive
    ? [record?.edited_at ? t("chat.edited_label") : null, album ? formatMessageTime(footTs, i18n.language) : time, receiptLabel]
        .filter(Boolean)
        .join(", ")
    : undefined;
  const reactions = Object.entries(record?.reactions ?? {}).filter(([, count]) => count > 0);
  const mine = new Set(record?.my_reactions ?? []);
  const meta = own ? "text-chat-bubble-own-meta" : "text-muted-foreground";
  const lift = own || scheme === "dark" ? null : Platform.OS === "ios" ? LIFT_IOS : LIFT_ANDROID;

  const body = (
    <View className={cn("px-2.5", compactTop ? "pt-0.5" : "pt-2.5", own ? "items-end" : "items-start", highlighted && "bg-primary/10")}>
      <View className={cn("max-w-full flex-row items-end gap-1.5", own ? "justify-end" : "justify-start")}>
        {avatar}
        <Pressable
          accessible={!interactive}
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityActions={actions}
          onAccessibilityAction={onAction}
          onLongPress={longPress}
          onPress={message.pending ? () => props.onPressPending(message) : undefined}
          delayLongPress={200}
          className={cn(
            album ? "gap-1 p-[3px]" : "gap-1 px-3 pb-2 pt-1.5",
            album ? null : "max-w-[72%]",
            own ? "bg-chat-bubble-own" : "bg-chat-bubble-other",
            ringed && "border-2 border-primary/25",
          )}
          style={[bubbleCorners(own, !compactTop, !continued), lift]}
        >
          {showSender ? (
            <Text className={cn("text-footnote font-semibold", senderNameClass(message.sender), album && "px-2 pt-0.5")} numberOfLines={1}>
              {senderName}
            </Text>
          ) : null}
          {quote ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.reply_quote_jump", { preview: quote.text })}
              // Inside a bubble read as one element the quote is its "open_quote" action, not a second stop.
              accessibilityElementsHidden={!interactive}
              importantForAccessibility={interactive ? "auto" : "no-hide-descendants"}
              hitSlop={8}
              android_ripple={quoteRipple}
              onPress={() => props.onPressQuote(quote.id)}
              className={cn(
                "rounded-[10px] border-l-[3px] px-2 py-1",
                own ? "border-chat-bubble-own-foreground bg-chat-bubble-own-foreground/15" : "border-primary bg-tint-blue",
              )}
            >
              <Text className={cn("text-footnote font-semibold", own ? "text-chat-bubble-own-foreground" : "text-primary")} numberOfLines={1}>
                {quote.sender}
              </Text>
              <Text className={cn("text-footnote", own ? "text-chat-bubble-own-foreground" : "text-muted-foreground")} numberOfLines={2}>
                {quote.text}
              </Text>
            </Pressable>
          ) : null}
          {album ? (
            <AlbumGrid photos={album} ctx={ctx} onLongPress={longPress} />
          ) : record ? (
            <MessageContent record={record} own={own} ctx={ctx} onLongPress={longPress} />
          ) : (
            <Text className="text-body text-chat-bubble-own-foreground">{preview}</Text>
          )}
          <View
            className={cn("flex-row items-center gap-1 self-end", album && "px-2 pb-1")}
            accessible={interactive}
            accessibilityLabel={footLabel}
          >
            {record ? (
              <>
                <Text className={cn("text-meta", meta)} style={{ fontVariant: ["tabular-nums"] }}>
                  {[record.edited_at ? t("chat.edited_label") : null, album ? formatMessageTime(footTs, i18n.language) : time]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {/* Seen is a filled badge in the bubble's ink, not only a lighter tint of delivered's two ticks. */}
                {receipt === "seen" ? (
                  <Ionicons name="checkmark-done-circle" size={16} color={theme.chatBubbleOwnForeground} testID="receipt-seen" />
                ) : null}
                {receipt === "delivered" ? <Ionicons name="checkmark-done" size={15} color={theme.chatBubbleOwnMeta} /> : null}
                {receipt === "sent" ? <Ionicons name="checkmark" size={15} color={theme.chatBubbleOwnMeta} /> : null}
              </>
            ) : message.pending ? (
              <PendingMeta pending={message.pending} scheme={scheme} />
            ) : null}
          </View>
        </Pressable>
      </View>
      {reactions.length > 0 ? (
        <View className={cn("mt-1 flex-row flex-wrap gap-1", own ? "justify-end" : "justify-start", avatar && "ml-9")}>
          {reactions.map(([emoji, count]) => (
            <Animated.View key={emoji} entering={REACTION_IN}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(mine.has(emoji) ? "chat.message_list.reaction_mine_aria" : "chat.message_list.reaction_aria", {
                  emoji,
                  count,
                })}
                accessibilityState={{ selected: mine.has(emoji) }}
                hitSlop={reactionSlop}
                android_ripple={reactionTap.android_ripple}
                onPress={() => props.onToggleReaction(message, emoji)}
                className={cn(
                  "min-h-[30px] flex-row items-center gap-1 rounded-full border px-2.5",
                  mine.has(emoji) ? "border-primary bg-tint-blue" : "border-border bg-chat-bubble-other",
                )}
              >
                <Text className="text-callout">{emoji}</Text>
                <Text className={cn("text-footnote font-semibold", mine.has(emoji) ? "text-primary" : "text-muted-foreground")}>{count}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      ) : null}
      {props.taskIds?.length ? (
        <View className={avatar ? "ml-9" : undefined}>
          <TaskCards ctx={ctx} taskIds={props.taskIds} own={own} />
        </View>
      ) : null}
      {showThread && record && record.reply_count > 0 ? (
        <Pressable
          accessibilityRole="button"
          // The label, not the children: the icon's glyph is a character a screen reader would spell.
          accessibilityLabel={t(record.thread_unread ? "chat.thread_replies_unread" : "chat.thread_replies", { count: record.reply_count })}
          {...threadTap}
          onPress={() => props.onPressThread(message)}
          className={cn("mt-1 min-h-8 flex-row items-center gap-1.5 rounded-full bg-chat-chip px-3", avatar && "ml-9")}
        >
          <Ionicons name="chatbubbles-outline" size={15} color={theme.primary} />
          <Text className="text-footnote font-semibold text-primary">
            {t(record.thread_unread ? "chat.thread_replies_unread" : "chat.thread_replies", { count: record.reply_count })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
  return (
    <LayoutAnimationConfig skipEntering={!fresh}>
      {fresh ? (
        <Animated.View entering={SEND_IN} testID="send-in">
          {body}
        </Animated.View>
      ) : (
        body
      )}
    </LayoutAnimationConfig>
  );
});
