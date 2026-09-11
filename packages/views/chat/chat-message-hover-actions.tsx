"use client";

import type { ReactNode } from "react";
import {
  Bookmark,
  Copy,
  Link2,
  ListTodo,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
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
import type { ChatMessage } from "./chat-messages";

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

export function ChatMessageHoverActions({
  message,
  isOwn,
  onReply,
  onReact,
  onThread,
  onEdit,
  onPin,
  onCopy,
  onDelete,
  onCreateTask,
  onLinkTask,
  onFollowUp,
  canEdit = true,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  onThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
  /** When false, the edit control stays visible but disabled. */
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const canInteract = Boolean(onReply && onReact);
  const canDelete = isOwn && Boolean(onDelete);
  const pinLabel = message.pinned ? t("chat.action_unpin") : t("chat.action_pin");
  const workHubActions = Boolean(onCreateTask || onLinkTask || onFollowUp);

  if (!canInteract) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-9 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface px-1 py-0.5 opacity-0 shadow-md transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
        isOwn ? "right-0" : "left-0",
      )}
    >
      <TooltipProvider delay={300}>
        <MessageActionButton label={t("chat.action_react")} onClick={() => onReact?.(message)}>
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
            {workHubActions ? (
              <>
                <DropdownMenuItem onClick={() => onFollowUp?.(message)} disabled={!onFollowUp}>
                  <Bookmark className="size-4" aria-hidden />
                  {t("chat.follow_up.action")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onCreateTask?.(message)}
                  disabled={!onCreateTask}
                >
                  <ListTodo className="size-4" aria-hidden />
                  {t("chat.link.create_task")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onLinkTask?.(message)} disabled={!onLinkTask}>
                  <Link2 className="size-4" aria-hidden />
                  {t("chat.link.link_task")}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onClick={() => onCopy?.(message)} disabled={!onCopy}>
              <Copy className="size-4" aria-hidden />
              {t("chat.action_copy")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete?.(message)}
              disabled={!canDelete}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("chat.action_delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  );
}
