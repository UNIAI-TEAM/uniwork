"use client";

import type { ReactNode } from "react";
import {
  Copy,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  Reply,
  SmilePlus,
  Trash2,
  Bell,
  CircleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { Check } from "lucide-react";
import type { ChatMessage } from "./chat-messages";
import { ChatMessageBody } from "./chat-message-body";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { senderNameClass } from "./sender-colors";

/** Fixed gutter matching sidebar avatar column — keeps grouped bubbles aligned. */
const INCOMING_AVATAR_SLOT_CLASS = "w-8 shrink-0";

function MessageActionButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={pressed ? "secondary" : "ghost"}
            size="icon-sm"
            className="size-8 shrink-0"
            aria-label={label}
            aria-pressed={pressed ? true : undefined}
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
  replyPreview?: string;
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
  const canDelete = isOwn && !isPending && message.kind !== "voice_call_log" && !message.voiceCall;
  const canInteract = !isPending && Boolean(onReply && onReact);
  const pinLabel = message.pinned ? t("chat.action_unpin") : t("chat.action_pin");

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
        <div
          className={cn(
            "pointer-events-none absolute -top-9 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface px-1 py-0.5 opacity-0 shadow-md transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
            isOwn ? "right-0" : "left-0",
            !canInteract && "hidden",
          )}
        >
          <TooltipProvider delay={300}>
            <MessageActionButton
              label={t("chat.action_react")}
              onClick={() => onReact?.(message)}
            >
              <SmilePlus className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton label={t("chat.action_reply")} onClick={() => onReply?.(message)}>
              <Reply className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton
              label={t("chat.action_thread")}
              onClick={() => onThread?.(message)}
              disabled={!onThread}
            >
              <MessageSquareText className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton
              label={t("chat.action_edit")}
              onClick={() => onEdit?.(message)}
              disabled={!canEdit || !onEdit}
            >
              <Pencil className="size-4" aria-hidden />
            </MessageActionButton>
            <MessageActionButton
              label={pinLabel}
              onClick={() => onPin?.(message)}
              disabled={!onPin}
              pressed={message.pinned}
            >
              <Pin className="size-4" aria-hidden />
            </MessageActionButton>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 shrink-0"
                    aria-label={t("chat.action_more")}
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </Button>
                }
              />
              <DropdownMenuContent align={isOwn ? "end" : "start"}>
                <DropdownMenuItem
                  onClick={() => onCopy?.(message)}
                  disabled={!onCopy}
                >
                  <Copy className="size-4" aria-hidden />
                  {t("chat.action_copy")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete?.(message)}
                  disabled={!canDelete || !onDelete}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t("chat.action_delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipProvider>
        </div>

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
