"use client";

import {
  Bell,
  Check,
  CircleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageBody } from "./chat-message-body";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import { ChatReplyQuote } from "./chat-reply-quote";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { senderNameClass } from "./sender-colors";

/** Fixed gutter matching sidebar avatar column — keeps grouped bubbles aligned. */
const INCOMING_AVATAR_SLOT_CLASS = "w-8 shrink-0";

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
  onThread,
  onEdit,
  onPin,
  onCopy,
  onDelete,
  showSenderName = false,
  compactTop = false,
  showAvatar = true,
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
  onThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  showSenderName?: boolean;
  compactTop?: boolean;
  showAvatar?: boolean;
  highlighted?: boolean;
  nameContext?: ChatNameContextEntry[];
}) {
  const { t } = useTranslation();
  const reactionEntries = Object.entries(message.reactions);
  const nameClass = senderNameClass(message.sender, isOwn);
  const avatarInitial = senderLabel.trim().slice(0, 1).toUpperCase() || "?";
  const isPending = message.deliveryStatus === "sending" || message.deliveryStatus === "queued";
  const canEdit = isOwn && !isPending && message.kind !== "voice_call_log" && !message.voiceCall;

  return (
    <article
      id={`chat-msg-${message.id}`}
      className={cn(
        "flex w-full max-w-full rounded-lg transition-colors",
        compactTop ? "mt-1" : "mt-3",
        isOwn ? "justify-end" : "justify-start gap-2",
        highlighted && "bg-brand/10 ring-2 ring-brand/40",
        isPending && "opacity-80",
      )}
    >
      {!isOwn ? (
        <div className={cn(INCOMING_AVATAR_SLOT_CLASS, "flex flex-col justify-end self-stretch")}>
          {showAvatar ? (
            <ActorAvatar
              name={senderLabel}
              initials={avatarInitial}
              size="sm"
              className="mx-auto shrink-0"
            />
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "group relative flex min-w-0 max-w-[min(100%,20rem)] flex-col gap-1",
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
            canEdit={canEdit}
          />
        ) : null}

        {!isOwn && showSenderName && showAvatar ? (
          <p className={cn("px-1 text-caption font-medium", nameClass)}>{senderLabel}</p>
        ) : null}

        {message.priority === "important" || message.priority === "urgent" ? (
          <span className="inline-flex items-center gap-1 px-1 text-caption font-medium text-destructive">
            {message.priority === "important" ? (
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <Bell className="size-3.5 shrink-0" aria-hidden />
            )}
            {message.priority === "important"
              ? t("chat.message_flag_important")
              : t("chat.message_flag_urgent")}
          </span>
        ) : null}

        <div
          className={cn(
            "w-fit max-w-full px-3.5 py-2",
            isOwn
              ? "rounded-[18px] rounded-br-[4px] bg-brand text-brand-foreground shadow-sm"
              : "rounded-[18px] rounded-bl-[4px] bg-surface shadow-sm ring-1 ring-border/60",
          )}
        >
          {replyToMessage && workspaceId && roomId ? (
            <ChatReplyQuote
              message={replyToMessage}
              workspaceId={workspaceId}
              roomId={roomId}
              isOwn={isOwn}
            />
          ) : null}

          <ChatMessageBody body={message.body} isOwn={isOwn} nameContext={nameContext} />
          {message.editedAt ? (
            <p
              className={cn(
                "mt-1 text-caption",
                isOwn ? "text-brand-foreground/75" : "text-muted-foreground",
              )}
            >
              {t("chat.edited_label")}
            </p>
          ) : null}
        </div>

        {reactionEntries.length > 0 ? (
          <div className={cn("flex flex-wrap gap-1 px-0.5", isOwn && "justify-end")}>
            {reactionEntries.map(([emoji, count]) => (
              <span
                key={emoji}
                className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-caption shadow-sm"
              >
                <span aria-hidden>{emoji}</span>
                {count > 1 ? <span className="text-muted-foreground">{count}</span> : null}
              </span>
            ))}
          </div>
        ) : null}

        {showReadReceipt ? (
          <span
            className="inline-flex px-1 text-muted-foreground"
            aria-label={t("chat.read_receipt")}
            title={t("chat.read_receipt")}
          >
            <Check className="size-3.5" aria-hidden />
          </span>
        ) : null}
        {isPending ? (
          <span className="px-1 text-caption text-muted-foreground">
            {message.deliveryStatus === "queued"
              ? t("chat.message_queued")
              : t("chat.message_sending")}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export { DEFAULT_QUICK_REACTION };
