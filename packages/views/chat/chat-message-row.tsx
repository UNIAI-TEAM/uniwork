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
import { DEFAULT_QUICK_REACTION } from "./matrix-message-actions";
import { senderBorderClass, senderDotClass, senderNameClass } from "./sender-colors";

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
}: {
  message: ChatMessage;
  senderLabel: string;
  isOwn: boolean;
  showReadReceipt: boolean;
  replyPreview?: string;
  onReply: (message: ChatMessage) => void;
  onReact: (message: ChatMessage) => void;
}) {
  const { t } = useTranslation();
  const reactionEntries = Object.entries(message.reactions);
  const nameClass = senderNameClass(message.sender, isOwn);
  const accentBorder = senderBorderClass(message.sender, isOwn);

  return (
    <article
      className={cn(
        "group relative rounded-lg border-l-[3px] px-2 py-1.5",
        accentBorder,
        isOwn ? "border-l-brand bg-brand/5" : "bg-surface-hover/40 hover:bg-surface-hover/70",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-9 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
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

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {!isOwn ? (
            <span
              className={cn("size-2 shrink-0 rounded-full", senderDotClass(message.sender))}
              aria-hidden
            />
          ) : null}
          <p className={cn("text-label font-semibold", nameClass)}>{senderLabel}</p>
          {showReadReceipt ? (
            <span
              className="inline-flex text-muted-foreground"
              aria-label={t("chat.read_receipt")}
              title={t("chat.read_receipt")}
            >
              <Check className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </div>

        {replyPreview ? (
          <p className="border-l-2 border-border pl-2 text-caption text-muted-foreground">
            {replyPreview}
          </p>
        ) : null}

        <p className="whitespace-pre-wrap break-words text-body text-foreground">{message.body}</p>

        {reactionEntries.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {reactionEntries.map(([emoji, count]) => (
              <span
                key={emoji}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-caption"
              >
                <span aria-hidden>{emoji}</span>
                <span className="text-muted-foreground">{count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export { DEFAULT_QUICK_REACTION };
