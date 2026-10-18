"use client";

import { lazy, Suspense, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Bookmark,
  Copy,
  Link2,
  MessageSquareText,
  Ellipsis,
  Pencil,
  Pin,
  Reply,
  FaceSlightlySmilingPlus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { ChatSeenByMenuItem } from "./chat-seen-by";
import { emojiPickerStrings } from "./chat-expression-utils";
import { MODULE_ICONS } from "../layout/module-icons";

/**
 * The column a message's bubble and its extras sit in. The actions bar floats
 * above it (absolute), so the rail itself only lines the column up with the
 * sender's side.
 */
export function chatMessageActionsRailClass(isOwn: boolean): string {
  return cn("flex w-fit max-w-full flex-col", isOwn ? "self-end" : "self-start");
}

/** The more menu's rows, the seen-by row among them: 40px, 10px corners, 18px glyphs (canvas). */
const MENU_CLASS = cn(
  "min-w-50 rounded-[14px] p-1.5",
  "*:data-[slot=dropdown-menu-item]:min-h-10 *:data-[slot=dropdown-menu-item]:gap-2.5 *:data-[slot=dropdown-menu-item]:rounded-control *:data-[slot=dropdown-menu-item]:px-2.5",
  "*:data-[slot=dropdown-menu-sub-trigger]:min-h-10 *:data-[slot=dropdown-menu-sub-trigger]:gap-2.5 *:data-[slot=dropdown-menu-sub-trigger]:rounded-control *:data-[slot=dropdown-menu-sub-trigger]:px-2.5",
);

/** The quick reactions the bar offers before the other actions. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"] as const;

// The composer's emoji set (search, categories, recently used), loaded on first open.
const EmojiPicker = lazy(() =>
  import("@uniwork/ui/components/common/emoji-picker").then((module) => ({
    default: module.EmojiPicker,
  })),
);

/**
 * "Thêm cảm xúc": any emoji beyond the quick six, from a popover picker. The
 * bar's button by default; `triggerClassName` dresses it as the round chip
 * after a message's reactions, whose picker opens under it (canvas).
 */
export function MessageReactionPicker({
  label,
  align,
  open,
  onOpenChange,
  onPick,
  side = "top",
  triggerClassName = "size-11 shrink-0 rounded-lg text-muted-foreground hover:text-foreground aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground",
  iconClassName = "size-5",
}: {
  label: string;
  align: "start" | "end";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  side?: "top" | "bottom";
  triggerClassName?: string;
  iconClassName?: string;
}) {
  const { t, i18n } = useTranslation();
  const strings = useMemo(() => emojiPickerStrings(i18n.language, t), [i18n.language, t]);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button type="button" variant="ghost" size="icon-lg" className={triggerClassName} aria-label={label} />
              }
            />
          }
        >
          <FaceSlightlySmilingPlus className={iconClassName} aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align={align}
        side={side}
        aria-label={label}
        className="w-auto max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0"
      >
        <Suspense fallback={<Spinner label={t("common.loading")} className="m-6 self-center" />}>
          <div className="[&_em-emoji-picker]:!border-0">
            <EmojiPicker onSelect={onPick} i18n={strings} />
          </div>
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

function MessageActionButton({
  label,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={pressed ? "secondary" : "ghost"}
            size="icon-lg"
            className={cn(
              "size-11 shrink-0 rounded-lg text-muted-foreground hover:text-foreground aria-pressed:text-foreground",
              className,
            )}
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
  onToggleReaction,
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
  /** When set, the bar leads with the quick reactions instead of the single 👍. */
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
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
  // The bar stays up while its picker is open: the pointer and focus are in the popover then.
  const [pickerOpen, setPickerOpen] = useState(false);
  const canInteract = Boolean(onReply && onReact);
  const canDelete = isOwn && Boolean(onDelete);
  const pinLabel = message.pinned ? t("chat.action_unpin") : t("chat.action_pin");
  const workHubActions = Boolean(onCreateTask || onLinkTask || onFollowUp);

  if (!canInteract) return null;

  // One tab stop per message: Tab enters on the first action, arrows move
  // along the bar (roving tabindex), so a long thread is not dozens of stops.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    // Quick reactions a narrow timeline hides are not stops.
    const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter(
      (button) => getComputedStyle(button).display !== "none",
    );
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
  // Buttons render with tabindex="0" themselves, so "is any at 0" cannot tell
  // an untouched bar from a roving one; the bar marks itself once set up.
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const bar = barRef.current;
    if (!bar || bar.dataset.roving === "on") return;
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button"));
    const target: EventTarget = event.target;
    const current = buttons.findIndex((button) => button === target);
    buttons.forEach((button, i) => button.setAttribute("tabindex", i === Math.max(current, 0) ? "0" : "-1"));
    bar.dataset.roving = "on";
  };

  const mine = new Set(message.myReactions ?? []);

  return (
    // Floats above the bubble on the sender's side; an invisible ::after
    // bridges the gap so the pointer can travel from the bubble into the bar
    // without losing group/message hover. Hidden until hover/focus (or a long
    // press on touch); buttons stay in the tab order (roving tabindex). On a
    // phone the bar wraps to two rows instead of running off the screen.
    <div
      ref={barRef}
      role="toolbar"
      aria-label={t("chat.message_actions_aria")}
      data-message-actions
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      className={cn(
        "pointer-events-none absolute bottom-full z-10 mb-1.5 flex w-max items-center rounded-xl border border-border bg-popover p-1 opacity-0 shadow-floating",
        "after:absolute after:inset-x-0 after:top-full after:h-1.5 after:content-['']",
        (forceOpen || pickerOpen) && "pointer-events-auto opacity-100",
        "transition-opacity duration-(--duration-fast) group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100",
        // Never wider than the timeline (a docked panel or the thread narrows it): it wraps instead of running under.
        "max-w-[calc(100cqw-3.5rem)] flex-wrap max-sm:max-w-72",
        isOwn ? "right-0" : "left-0",
      )}
    >
      <TooltipProvider delay={300}>
        {onToggleReaction ? (
          <>
            {QUICK_REACTIONS.map((emoji, index) => (
              <MessageActionButton
                key={emoji}
                label={t("chat.action_react_emoji", { emoji })}
                onClick={() => onToggleReaction(message, emoji)}
                pressed={mine.has(emoji)}
                // A narrow timeline keeps three; the rest are one tap away in the picker.
                className={index >= 3 ? "@max-xl/timeline:hidden" : undefined}
              >
                <span aria-hidden className="text-display-sm leading-none">
                  {emoji}
                </span>
              </MessageActionButton>
            ))}
            <MessageReactionPicker
              label={t("chat.action_react_more")}
              align={isOwn ? "end" : "start"}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={(emoji) => {
                onToggleReaction(message, emoji);
                setPickerOpen(false);
              }}
            />
            <span aria-hidden className="mx-1 h-6 w-px bg-border max-sm:hidden" />
          </>
        ) : (
          <MessageActionButton label={t("chat.action_react")} onClick={() => onReact?.(message)}>
            <FaceSlightlySmilingPlus className="size-5" aria-hidden />
          </MessageActionButton>
        )}
        <MessageActionButton label={t("chat.action_reply")} onClick={() => onReply?.(message)}>
          <Reply className="size-5" aria-hidden />
        </MessageActionButton>
        {onThread ? (
          <MessageActionButton
            label={t("chat.action_thread")}
            onClick={() => onThread(message)}
          >
            <MessageSquareText className="size-5" aria-hidden />
          </MessageActionButton>
        ) : null}
        {canEdit && onEdit ? (
          <MessageActionButton label={t("chat.action_edit")} onClick={() => onEdit(message)}>
            <Pencil className="size-5" aria-hidden />
          </MessageActionButton>
        ) : null}
        {onPin ? (
          <MessageActionButton label={pinLabel} onClick={() => onPin(message)} pressed={message.pinned}>
            <Pin className="size-5" aria-hidden />
          </MessageActionButton>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="size-11 shrink-0 rounded-lg text-muted-foreground hover:text-foreground aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground"
                aria-label={t("chat.action_more")}
              >
                <Ellipsis className="size-5" aria-hidden />
              </Button>
            }
          />
          {/* Roomier rows than the default menu: 40px each, 18px glyphs (canvas). */}
          <DropdownMenuContent
            align={isOwn ? "end" : "start"}
            className={MENU_CLASS}
          >
            {isOwn ? <ChatSeenByMenuItem message={message} /> : null}
            {workHubActions ? (
              <>
                <DropdownMenuItem onClick={() => onFollowUp?.(message)} disabled={!onFollowUp}>
                  <Bookmark className="size-4.5" aria-hidden />
                  {t("chat.follow_up.action")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onCreateTask?.(message)}
                  disabled={!onCreateTask}
                >
                  <MODULE_ICONS.tasks className="size-4.5" aria-hidden />
                  {t("chat.link.create_task")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onLinkTask?.(message)} disabled={!onLinkTask}>
                  <Link2 className="size-4.5" aria-hidden />
                  {t("chat.link.link_task")}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onClick={() => onCopy?.(message)} disabled={!onCopy}>
              <Copy className="size-4.5" aria-hidden />
              {t("chat.action_copy")}
            </DropdownMenuItem>
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete?.(message)}>
                  <Trash2 className="size-4.5" aria-hidden />
                  {t("chat.action_delete")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  );
}
