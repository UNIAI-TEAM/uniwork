"use client";

import type { ReactNode } from "react";
import {
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  Reply,
  SmilePlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { Check } from "lucide-react";
import type { ChatMessage } from "./chat-messages";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import { senderNameClass } from "./sender-colors";

/** Fixed gutter matching sidebar avatar column — keeps grouped bubbles aligned. */
const INCOMING_AVATAR_SLOT_CLASS = "w-8 shrink-0";

function MessageActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 shrink-0"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChatMessageRow({
  message,
  senderLabel,
  isOwn,
  showReadReceipt,
  replyPreview,
  onReply,
  onReact,
  showSenderName = false,
  compactTop = false,
  showAvatar = true,
}: {
  message: ChatMessage;
  senderLabel: string;
  isOwn: boolean;
  showReadReceipt: boolean;
  replyPreview?: string;
  onReply: (message: ChatMessage) => void;
  onReact: (message: ChatMessage) => void;
  showSenderName?: boolean;
  compactTop?: boolean;
  showAvatar?: boolean;
}) {
  const { t } = useTranslation();
  const reactionEntries = Object.entries(message.reactions);
  const nameClass = senderNameClass(message.sender, isOwn);
  const avatarInitial = senderLabel.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <article
      className={cn(
        "flex w-full max-w-full",
        compactTop ? "mt-1" : "mt-3",
        isOwn ? "justify-end" : "justify-start gap-2",
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
        <div
          className={cn(
            "pointer-events-none absolute -top-9 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface px-1 py-0.5 opacity-0 shadow-md transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
            isOwn ? "right-0" : "left-0",
          )}
        >
          <TooltipProvider delay={300}>
            <MessageActionButton
              label={t("chat.action_react")}
              onClick={() => onReact(message)}
            >
              <SmilePlus className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton label={t("chat.action_reply")} onClick={() => onReply(message)}>
              <Reply className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton label={t("chat.action_thread")} disabled>
              <MessageSquareText className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton label={t("chat.action_edit")} disabled>
              <Pencil className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton label={t("chat.action_pin")} disabled>
              <Pin className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton label={t("chat.action_more")} disabled>
              <MoreHorizontal className="size-4" aria-hidden />
            </MessageActionButton>
          </TooltipProvider>
        </div>

        {!isOwn && showSenderName && showAvatar ? (
          <p className={cn("px-1 text-caption font-medium", nameClass)}>{senderLabel}</p>
        ) : null}

        <div
          className={cn(
            "w-fit max-w-full px-3.5 py-2",
            isOwn
              ? "rounded-[18px] rounded-br-[4px] bg-brand text-brand-foreground shadow-sm"
              : "rounded-[18px] rounded-bl-[4px] bg-surface shadow-sm ring-1 ring-border/60",
          )}
        >
          {replyPreview ? (
            <p
              className={cn(
                "mb-1.5 border-l-2 pl-2 text-caption",
                isOwn
                  ? "border-brand-foreground/40 text-brand-foreground/85"
                  : "border-brand/40 text-muted-foreground",
              )}
            >
              {replyPreview}
            </p>
          ) : null}

          <p
            className={cn(
              "whitespace-pre-wrap break-words text-body leading-relaxed",
              isOwn ? "text-brand-foreground" : "text-foreground",
            )}
          >
            {message.body}
          </p>
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
      </div>
    </article>
  );
}

export { DEFAULT_QUICK_REACTION };
