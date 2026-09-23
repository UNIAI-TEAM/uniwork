"use client";

import { Check, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";

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
}: {
  message: ChatMessage;
  isOwn: boolean;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(message.reactions);
  if (entries.length === 0) return null;
  const mine = new Set(message.myReactions ?? []);
  return (
    <div className={cn("flex flex-wrap gap-1", isOwn && "justify-end")}>
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
            // The chip stays 24px to the eye; on touch an invisible ::after
            // extends the target to 44px so a thumb lands on it.
            className={cn(
              "relative inline-flex h-6 items-center gap-1 rounded-full border px-2 text-caption transition-colors duration-(--duration-fast) disabled:cursor-default pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']",
              pressed
                ? "border-brand bg-surface-selected hover:bg-surface-selected"
                : "border-border bg-surface hover:bg-surface-hover disabled:hover:bg-surface",
            )}
          >
            <span aria-hidden>{emoji}</span>
            {count > 1 ? (
              <span className={cn("font-medium tabular-nums", pressed ? "text-foreground" : "text-muted-foreground")}>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Time, edited mark, delivery state and read receipt — the one line of meta a
 * message carries. Shown on the last message of a run (and always while a
 * message is on its way). The time for a screen reader lives in the
 * message's accessible name instead (ChatMessageA11yLabel).
 */
export function ChatMessageMeta({
  message,
  isOwn,
  showTime,
  showReadReceipt = false,
}: {
  message: ChatMessage;
  isOwn: boolean;
  showTime: boolean;
  showReadReceipt?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const pending = message.deliveryStatus === "sending" || message.deliveryStatus === "queued";
  if (!showTime && !pending && !message.editedAt && !showReadReceipt) return null;
  return (
    <p
      className={cn(
        "mt-0.5 flex items-center gap-1 text-micro text-muted-foreground tabular-nums",
        isOwn ? "justify-end" : "justify-start",
      )}
    >
      {pending ? (
        // Full contrast while on its way: the state is in words and a glyph,
        // not in a faded bubble.
        <span className="inline-flex items-center gap-1 text-foreground">
          <Clock3 className="size-3" aria-hidden />
          {message.deliveryStatus === "queued" ? t("chat.message_queued") : t("chat.message_sending")}
        </span>
      ) : showTime ? (
        <time dateTime={new Date(message.ts).toISOString()} aria-hidden>
          {formatMessageTime(message.ts, i18n.language)}
        </time>
      ) : null}
      {message.editedAt ? <span>· {t("chat.edited_label")}</span> : null}
      {showReadReceipt ? (
        <span className="inline-flex items-center gap-0.5 text-brand-subtle-foreground">
          <Check className="size-3" aria-hidden />
          <span className="sr-only sm:not-sr-only">{t("chat.read_receipt")}</span>
        </span>
      ) : null}
    </p>
  );
}
