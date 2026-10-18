"use client";

import { createContext, useContext, useState } from "react";
import { Check, CheckCheck, Clock3, FaceSlightlySmiling, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMessageSeenByPeer } from "@uniwork/core/chat/read-receipt-utils";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatPeerDeliveredAtContext } from "./chat-delivered";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";
import { MessageReactionPicker } from "./chat-message-hover-actions";

/** The id of a message's accessible name, for `aria-labelledby` on its article. */
export function chatMessageLabelId(messageId: string): string {
  return `chat-msg-label-${messageId}`;
}

/**
 * Who sent a message and when, for a screen reader. The eye gets this from
 * the bubble's side, the avatar and the run's last time; a listener moving
 * message by message gets none of that, so every message names its sender
 * ("Bạn" for mine) and its time, whatever the grouping hides.
 */
export function ChatMessageA11yLabel({ messageId, senderLabel, ts }: { messageId: string; senderLabel: string; ts: number }) {
  const { t, i18n } = useTranslation();
  return (
    <span id={chatMessageLabelId(messageId)} className="sr-only">
      {t("chat.message_list.label", { sender: senderLabel, time: formatMessageDateTime(ts, i18n.language) })}
    </span>
  );
}

/**
 * Reaction chips: each toggles that emoji for me. Mine are drawn selected and
 * pressed, so both the eye and a screen reader know which ones I added.
 */
export function ChatReactionChips({
  message,
  isOwn,
  onToggleReaction,
  onReact,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  /** The round smiley after the chips: opens the full picker. */
  onReact?: (message: ChatMessage) => void;
}) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Most given first (canvas: 👍 6, 🎉 3, ❤️ 2); a tie keeps the server's order.
  const entries = Object.entries(message.reactions).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;
  const mine = new Set(message.myReactions ?? []);
  return (
    <div className={cn("mt-0.5 flex flex-wrap gap-1", isOwn && "justify-end")}>
      {entries.map(([emoji, count]) => {
        const pressed = mine.has(emoji);
        return (
          <button
            key={emoji}
            type="button"
            disabled={!onToggleReaction}
            aria-pressed={pressed}
            aria-label={
              pressed
                ? t("chat.message_list.reaction_mine_aria", { emoji, count })
                : t("chat.message_list.reaction_aria", { emoji, count })
            }
            onClick={() => onToggleReaction?.(message, emoji)}
            // The pill stays 28px to the eye; on touch an invisible ::after
            // extends the target to 44px so a thumb lands on it.
            className={cn(
              "relative inline-flex h-7 items-center gap-1 rounded-full border px-2.25 text-label transition-colors duration-(--duration-fast) disabled:cursor-default pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2 pointer-coarse:after:content-['']",
              pressed
                ? "border-brand bg-brand-subtle hover:bg-brand/15 disabled:hover:bg-brand-subtle"
                : "border-border bg-surface hover:bg-surface-hover disabled:hover:bg-surface",
            )}
          >
            <span aria-hidden>{emoji}</span>
            {count > 1 ? (
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  pressed ? "text-brand" : "text-chat-chip-foreground",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
      {onToggleReaction ? (
        <MessageReactionPicker
          label={t("chat.action_react_more")}
          align={isOwn ? "end" : "start"}
          side="bottom"
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={(emoji) => {
            onToggleReaction(message, emoji);
            setPickerOpen(false);
          }}
          triggerClassName="relative size-7 rounded-full border border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground aria-expanded:border-brand aria-expanded:bg-brand-subtle aria-expanded:text-brand pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-['']"
          iconClassName="size-3.75"
        />
      ) : onReact ? (
        <button
          type="button"
          aria-label={t("chat.action_react_more")}
          onClick={() => onReact(message)}
          className="relative inline-flex size-7 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-['']"
        >
          <FaceSlightlySmiling className="size-3.75" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * How far the other side has read (the DM peer, or anyone in a group): every
 * message of mine up to it carries ✓✓, later ones ✓. Null in a thread.
 */
export const ChatPeerReadAtContext = createContext<string | null>(null);

/**
 * Time, edited mark, delivery state and read receipt — the one line of meta a
 * message carries. Shown on the last message of a run (and always while a
 * message is on its way). Inside a bubble it sits at the bottom-right in the
 * bubble's own meta colour; `onWall` draws it as a small chip on the chat
 * wall instead (under a sticker, GIF or anything drawn without a bubble).
 * `inline="float"` floats it at the end of the text's last line, dropped to
 * the bubble's foot, and onto a line of its own when that line is full;
 * `inline="end"` ends a flex row (a voice message's duration line);
 * `inline="media"` sits on a photo's bottom-right corner (canvas).
 * The time for a screen reader lives in the message's accessible name
 * instead (ChatMessageA11yLabel).
 */
export function ChatMessageMeta({
  message,
  isOwn,
  showTime,
  showReadReceipt = false,
  onWall = false,
  inline,
}: {
  message: ChatMessage;
  isOwn: boolean;
  showTime: boolean;
  showReadReceipt?: boolean;
  onWall?: boolean;
  inline?: "float" | "end" | "media";
}) {
  const { t, i18n } = useTranslation();
  const peerReadAt = useContext(ChatPeerReadAtContext);
  const deliveredAt = useContext(ChatPeerDeliveredAtContext);
  const pending = message.deliveryStatus === "sending" || message.deliveryStatus === "queued";
  // A failed send keeps its time in the bubble; "Chưa gửi được" sits under it (ChatFailedSendBar).
  const withTime = showTime || message.deliveryStatus === "failed";
  if (!withTime && !pending && !message.editedAt && !showReadReceipt) return null;
  const onBrand = isOwn && !onWall && inline !== "media";
  // Mine, on the server and timed: ✓ sent, faint ✓✓ once every other member's device has it, ✓✓ once read
  // (WebMessageKinds). The latest read one says so in words.
  const tick =
    isOwn && withTime && !showReadReceipt && !message.deliveryStatus && !isPendingChatMessageId(message.id)
      ? isMessageSeenByPeer(message.ts, peerReadAt)
        ? "seen"
        : isMessageSeenByPeer(message.ts, deliveredAt)
          ? "delivered"
          : "sent"
      : null;
  const Tag = inline ? "span" : "p";
  return (
    <Tag
      className={cn(
        "flex items-center gap-1 text-micro tabular-nums",
        onWall
          ? cn("mt-0.5 w-fit rounded-md bg-chat-chip px-2 py-0.5 text-chat-chip-foreground", isOwn && "self-end")
          : inline === "media"
            ? // Over a photo's corner, on the stage's dark wash in both themes (canvas).
              "absolute right-2 bottom-2 rounded-md bg-meeting-video-bg/55 px-1.5 py-0.5 text-meeting-stage-foreground"
            : cn(
                inline === "float"
                  ? "relative top-[7px] float-right ml-3 h-[21px]"
                  : inline === "end"
                    ? "ml-auto"
                    : "mt-0.5 ml-auto justify-end",
                onBrand ? "text-chat-bubble-own-meta" : "text-muted-foreground",
              ),
      )}
    >
      {pending ? (
        // Full contrast while on its way: the state is in words and a glyph,
        // not in a faded bubble.
        <span
          className={cn(
            "inline-flex items-center gap-1",
            onBrand ? "text-chat-bubble-own-foreground" : "text-foreground",
          )}
        >
          {message.deliveryStatus === "queued" ? (
            <WifiOff className="size-3" aria-hidden />
          ) : (
            <Clock3 className="size-3" aria-hidden />
          )}
          {message.deliveryStatus === "queued" ? t("chat.message_queued") : t("chat.message_sending")}
        </span>
      ) : withTime ? (
        <time dateTime={new Date(message.ts).toISOString()} aria-hidden>
          {formatMessageTime(message.ts, i18n.language)}
        </time>
      ) : null}
      {/* The dot only separates it from a time or a sending state before it. */}
      {message.editedAt ? <span>{pending || withTime ? `· ${t("chat.edited_label")}` : t("chat.edited_label")}</span> : null}
      {tick === "seen" ? (
        <CheckCheck
          role="img"
          aria-label={t("chat.read_receipt")}
          className={cn("size-3.75", onBrand ? "text-chat-bubble-own-foreground" : inline === "media" ? undefined : "text-brand")}
        />
      ) : tick === "delivered" ? (
        <CheckCheck
          role="img"
          aria-label={t("chat.receipt_delivered")}
          className={cn(
            "size-3.75",
            onBrand ? "text-chat-bubble-own-foreground/60" : inline === "media" ? "opacity-60" : "text-muted-foreground",
          )}
        />
      ) : tick === "sent" ? (
        <Check role="img" aria-label={t("chat.receipt_sent")} className="size-3.75" />
      ) : null}
      {showReadReceipt ? (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 font-semibold",
            onBrand ? "text-chat-bubble-own-foreground" : "text-brand",
          )}
        >
          <CheckCheck className="size-3.5" aria-hidden />
          <span className="sr-only sm:not-sr-only">{t("chat.read_receipt")}</span>
        </span>
      ) : null}
    </Tag>
  );
}
