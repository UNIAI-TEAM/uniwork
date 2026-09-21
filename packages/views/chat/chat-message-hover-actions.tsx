"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
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
            className="shrink-0 text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
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
  forceOpen = false,
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
  /** When false the edit control is left out (someone else's message, a call log). */
  canEdit?: boolean;
  /** Opened by a long press on touch, where there is no hover. */
  forceOpen?: boolean;
}) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const canInteract = Boolean(onReply && onReact);
  const canDelete = isOwn && Boolean(onDelete);
  const pinLabel = message.pinned ? t("chat.action_unpin") : t("chat.action_pin");
  const workHubActions = Boolean(onCreateTask || onLinkTask || onFollowUp);

  if (!canInteract) return null;

  // One tab stop per message: Tab enters on the first action, arrows move
  // along the bar (roving tabindex), so a long thread is not dozens of stops.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons.forEach((button, i) => button.setAttribute("tabindex", i === next ? "0" : "-1"));
    buttons[next]?.focus();
  };
  const onFocusCapture = () => {
    const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (buttons.some((button) => button.getAttribute("tabindex") === "0")) return;
    buttons.forEach((button, i) => button.setAttribute("tabindex", i === 0 ? "0" : "-1"));
  };

  return (
    // Beside the bubble from sm (in the free lane of the column, so it never
    // covers the message above); on a phone it sits over the bubble's top
    // edge. Hidden until the message is hovered or holds focus — the buttons
    // stay in the tab order, and focusing one reveals the bar.
    // The toolbar is not a tab stop itself; its buttons are (roving tabindex).
    <div
      ref={barRef}
      role="toolbar"
      aria-label={t("chat.message_actions_aria")}
      data-message-actions
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      className={cn(
        "pointer-events-none absolute z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5 opacity-0 shadow-[var(--menu-shadow)]",
        forceOpen && "pointer-events-auto opacity-100",
        "transition-opacity duration-(--duration-fast) group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100",
        "-top-8 sm:top-0",
        isOwn ? "right-0 sm:right-full sm:mr-2" : "left-0 sm:left-full sm:ml-2",
      )}
    >
      <TooltipProvider delay={300}>
        <MessageActionButton label={t("chat.action_react")} onClick={() => onReact?.(message)}>
          <SmilePlus className="size-4" aria-hidden />
        </MessageActionButton>
        <MessageActionButton label={t("chat.action_reply")} onClick={() => onReply?.(message)}>
          <Reply className="size-4" aria-hidden />
        </MessageActionButton>
        {onThread ? (
          <MessageActionButton
            label={t("chat.action_thread")}
            onClick={() => onThread(message)}
          >
            <MessageSquareText className="size-4" aria-hidden />
          </MessageActionButton>
        ) : null}
        {canEdit && onEdit ? (
          <MessageActionButton label={t("chat.action_edit")} onClick={() => onEdit(message)}>
            <Pencil className="size-4" aria-hidden />
          </MessageActionButton>
        ) : null}
        {onPin ? (
          <MessageActionButton label={pinLabel} onClick={() => onPin(message)} pressed={message.pinned}>
            <Pin className="size-4" aria-hidden />
          </MessageActionButton>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
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
            {canDelete ? (
              <DropdownMenuItem variant="destructive" onClick={() => onDelete?.(message)}>
                <Trash2 className="size-4" aria-hidden />
                {t("chat.action_delete")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  );
}
