"use client";

import { Bell, Check, CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageBody } from "./chat-message-body";
import { isChatMediaMessageBody } from "./chat-expression-utils";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import { formatMessageDateTime, formatMessageTime } from "./chat-message-time";
import { ChatReplyQuote } from "./chat-reply-quote";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import { MessageTaskCard } from "./message-task-card";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { senderNameClass } from "./sender-colors";
import { initialOf } from "./chat-initials";
import { useMessageActionsReveal } from "./use-message-actions-reveal";

/** Fixed gutter matching the 32px avatar — keeps grouped bubbles aligned. */
const INCOMING_AVATAR_SLOT_CLASS = "w-8 shrink-0";

/**
 * The two bubble fills. Mine is the brand wash, theirs the muted wash: both
 * pale, so body text, links and the time read the same in either and a long
 * thread does not become a wall of saturated blue.
 */
export const CHAT_BUBBLE_OWN = "bg-brand-subtle";
export const CHAT_BUBBLE_OTHER = "bg-muted";

/** Rounded bubble with a tighter corner on the sender's side for the first of a run. */
export function chatBubbleShape(isOwn: boolean, firstOfRun: boolean): string {
  if (!firstOfRun) return "rounded-2xl";
  return isOwn ? "rounded-2xl rounded-tr-md" : "rounded-2xl rounded-tl-md";
}

/** Important is a warning, urgent is a danger — never the same red. */
export function ChatPriorityFlag({ priority }: { priority: ChatMessage["priority"] }) {
  const { t } = useTranslation();
  if (priority !== "important" && priority !== "urgent") return null;
  const urgent = priority === "urgent";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-semibold",
        urgent
          ? "bg-destructive-soft text-destructive-soft-foreground"
          : "bg-warning-soft text-warning-soft-foreground",
      )}
    >
      {urgent ? <Bell className="size-3 shrink-0" aria-hidden /> : <CircleAlert className="size-3 shrink-0" aria-hidden />}
      {urgent ? t("chat.message_flag_urgent") : t("chat.message_flag_important")}
    </span>
  );
}

/** Reaction chips: each one toggles that emoji for me. */
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
  return (
    <div className={cn("flex flex-wrap gap-1", isOwn && "justify-end")}>
      {entries.map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          disabled={!onToggleReaction}
          aria-label={t("chat.reaction_toggle_aria", { emoji, count })}
          onClick={() => onToggleReaction?.(message, emoji)}
          // The chip stays 24px to the eye; on touch an invisible ::after
          // extends the target to 44px so a thumb lands on it.
          className="relative inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-caption transition-colors duration-(--duration-fast) hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-surface pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']"
        >
          <span aria-hidden>{emoji}</span>
          {count > 1 ? <span className="font-medium text-muted-foreground tabular-nums">{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Time, edited mark, delivery state and read receipt — the one line of meta a
 * message carries. Shown on the last message of a run (and always while a
 * message is on its way); the others keep the full time in their tooltip.
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
  // Mid-run messages hide their time from the eye (the run's last one shows
  // it) but never from a screen reader: it hears every message's time.
  if (!showTime && !pending && !message.editedAt && !showReadReceipt) {
    return (
      <time dateTime={new Date(message.ts).toISOString()} className="sr-only">
        {formatMessageDateTime(message.ts, i18n.language)}
      </time>
    );
  }
  return (
    <p
      className={cn(
        "mt-0.5 flex items-center gap-1 text-micro text-muted-foreground tabular-nums",
        isOwn ? "justify-end" : "justify-start",
      )}
    >
      {pending ? (
        <span>{message.deliveryStatus === "queued" ? t("chat.message_queued") : t("chat.message_sending")}</span>
      ) : showTime ? (
        <time dateTime={new Date(message.ts).toISOString()}>{formatMessageTime(message.ts, i18n.language)}</time>
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

export function ChatMessageRow({
  message,
  senderLabel,
  isOwn,
  showReadReceipt,
  replyToMessage,
  workspaceId,
  roomId,
  onReply,
  onReact,
  onToggleReaction,
  onJumpToMessage,
  onThread,
  onEdit,
  onPin,
  onCopy,
  onDelete,
  onCreateTask,
  onLinkTask,
  onFollowUp,
  workHubEnabled = false,
  showSenderName = false,
  compactTop = false,
  showAvatar = true,
  lastOfRun = true,
  highlighted = false,
  nameContext = [],
}: {
  message: ChatMessage;
  senderLabel: string;
  isOwn: boolean;
  showReadReceipt: boolean;
  replyToMessage?: ChatMessage;
  workspaceId?: string;
  roomId?: string;
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
  workHubEnabled?: boolean;
  showSenderName?: boolean;
  compactTop?: boolean;
  showAvatar?: boolean;
  /** The next message starts a new run (other sender or a pause): print the time here. */
  lastOfRun?: boolean;
  highlighted?: boolean;
  nameContext?: ChatNameContextEntry[];
}) {
  const { t, i18n } = useTranslation();
  const reveal = useMessageActionsReveal();
  const nameClass = senderNameClass(message.sender, isOwn);
  const isPending = message.deliveryStatus === "sending" || message.deliveryStatus === "queued";
  // A sticker or GIF is not text: there is nothing to edit in it.
  const isMedia = isChatMediaMessageBody(message.body);
  const canEdit = isOwn && !isPending && message.kind !== "voice_call_log" && !message.voiceCall && !isMedia;

  return (
    <article
      id={`chat-msg-${message.id}`}
      className={cn(
        "flex w-full max-w-full rounded-lg transition-colors duration-(--duration-standard)",
        compactTop ? "mt-0.5" : "mt-3",
        isOwn ? "justify-end" : "justify-start gap-2",
        highlighted && "bg-brand-subtle ring-2 ring-brand",
        isPending && "opacity-70",
      )}
    >
      {!isOwn ? (
        <div className={INCOMING_AVATAR_SLOT_CLASS}>
          {showAvatar ? (
            <ActorAvatar name={senderLabel} initials={initialOf(senderLabel)} size="lg" className="shrink-0" />
          ) : null}
        </div>
      ) : null}

      {/* Long press opens the actions on touch; the copy callout is off there
          because "Sao chép" lives in that same bar. */}
      <div
        ref={reveal.rootRef}
        {...reveal.bind}
        className={cn(
          "group/message relative flex min-w-0 max-w-[min(85%,36rem)] flex-col gap-1 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]",
          isOwn ? "items-end" : "items-start",
        )}
      >
        {!isPending ? (
          <ChatMessageHoverActions
            message={message}
            isOwn={isOwn}
            onReply={onReply}
            onReact={onReact}
            onThread={onThread}
            onEdit={onEdit}
            onPin={onPin}
            onCopy={onCopy}
            onDelete={onDelete}
            onCreateTask={workHubEnabled ? onCreateTask : undefined}
            onLinkTask={workHubEnabled ? onLinkTask : undefined}
            onFollowUp={workHubEnabled ? onFollowUp : undefined}
            canEdit={canEdit}
            forceOpen={reveal.open}
          />
        ) : null}

        {!isOwn && showSenderName && showAvatar ? (
          <p className={cn("px-1 text-caption font-semibold", nameClass)}>{senderLabel}</p>
        ) : null}

        <ChatPriorityFlag priority={message.priority} />

        <div
          title={formatMessageDateTime(message.ts, i18n.language)}
          className={cn(
            "w-fit max-w-full",
            // A sticker, GIF or image is the message itself: no bubble behind
            // it, only the time under it — unless it answers another message.
            isMedia && !replyToMessage
              ? "p-0"
              : cn("px-3 py-2", chatBubbleShape(isOwn, !compactTop), isOwn ? CHAT_BUBBLE_OWN : CHAT_BUBBLE_OTHER),
          )}
        >
          {replyToMessage && workspaceId && roomId ? (
            <ChatReplyQuote
              message={replyToMessage}
              workspaceId={workspaceId}
              roomId={roomId}
              isOwn={isOwn}
              onJump={onJumpToMessage}
            />
          ) : null}

          <ChatMessageBody body={message.body} isOwn={isOwn} nameContext={nameContext} />
          <ChatMessageMeta
            message={message}
            isOwn={isOwn}
            showTime={lastOfRun}
            showReadReceipt={showReadReceipt}
          />
        </div>

        <ChatReactionChips message={message} isOwn={isOwn} onToggleReaction={onToggleReaction} />

        {(message.replyCount ?? 0) > 0 && onThread && !message.threadRootId ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className={cn("h-auto px-1 py-0.5 text-brand-subtle-foreground", isOwn && "self-end")}
            onClick={() => onThread(message)}
          >
            {message.threadUnread
              ? t("chat.thread_replies_unread", { count: message.replyCount })
              : t("chat.thread_replies", { count: message.replyCount })}
          </Button>
        ) : null}

        {workHubEnabled && workspaceId && !isPending ? (
          <MessageTaskCard
            workspaceId={workspaceId}
            messageId={message.id}
            className={cn(isOwn && "items-end self-end")}
          />
        ) : null}
      </div>
    </article>
  );
}

export { DEFAULT_QUICK_REACTION };
