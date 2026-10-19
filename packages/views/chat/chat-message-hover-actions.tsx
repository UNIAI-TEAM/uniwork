"use client";

import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Bookmark,
  ChevronDown,
  Copy,
  Link2,
  MessageSquareText,
  Forward,
  Pencil,
  Pin,
  Reply,
  FaceSlightlySmilingPlus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
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
import { ChatSeenByContextRow } from "./chat-seen-by";
import { ChatForwardContext, isForwardableChatMessage } from "./chat-forward-context";
import { emojiPickerStrings } from "./chat-expression-utils";
import { useActionsBarPlacement } from "./use-actions-bar-placement";
import { MODULE_ICONS } from "../layout/module-icons";

/**
 * The column a message's bubble and its extras sit in. The actions bar floats
 * above it (absolute), so the rail itself only lines the column up with the
 * sender's side.
 */
export function chatMessageActionsRailClass(isOwn: boolean): string {
  return cn("flex w-fit max-w-full flex-col", isOwn ? "self-end" : "self-start");
}

const CONTEXT_MENU_ROW = cn(
  "flex w-full min-h-10 items-center gap-2.5 rounded-control px-2.5 text-body text-foreground",
  "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
);

const CONTEXT_PANEL = "min-w-52 rounded-xl border border-border bg-popover py-1 shadow-floating";
const REACTION_PILL = "flex items-center gap-0.5 rounded-full border border-border bg-popover px-1.5 py-1 shadow-floating";

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
  icon: Icon = FaceSlightlySmilingPlus,
}: {
  label: string;
  align: "start" | "end";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  side?: "top" | "bottom";
  triggerClassName?: string;
  iconClassName?: string;
  icon?: LucideIcon;
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
          <Icon className={iconClassName} aria-hidden />
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

function ContextMenuRow({
  label,
  icon: Icon,
  onClick,
  disabled,
  destructive,
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(CONTEXT_MENU_ROW, destructive && "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10")}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate text-left">{label}</span>
    </button>
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
  /** Opened by right-click or a long press on touch. */
  forceOpen?: boolean;
}) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  // The bar stays up while its picker is open: the pointer and focus are in the popover then.
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (!forceOpen) setPickerOpen(false);
  }, [forceOpen]);
  const onForward = useContext(ChatForwardContext);
  const canInteract = Boolean(onReply && onReact);
  const canDelete = isOwn && Boolean(onDelete);
  const pinLabel = message.pinned ? t("chat.action_unpin") : t("chat.action_pin");
  const workHubActions = Boolean(onCreateTask || onLinkTask || onFollowUp);
  useActionsBarPlacement(barRef, canInteract);

  if (!canInteract) return null;

  // One tab stop per message: Tab enters on the first action, arrows move
  // along the bar (roving tabindex), so a long thread is not dozens of stops.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    // Quick reactions a narrow timeline hides are not stops.
    const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter(
      (button) => getComputedStyle(button).display !== "none",
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (forward ? 1 : -1) + buttons.length) % buttons.length;
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

  const showSecondary =
    Boolean(onThread || (canEdit && onEdit) || workHubActions || isOwn);

  return (
    // Telegram-style stack: reaction pill, then a labelled context menu. Shown on
    // right-click, long press, or keyboard focus into the message.
    <div
      ref={barRef}
      data-message-actions
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      className={cn(
        "pointer-events-none absolute bottom-full z-10 mb-1.5 flex w-max flex-col gap-1.5 opacity-0",
        "after:absolute after:inset-x-0 after:top-full after:h-1.5 after:content-['']",
        "data-[place=inside]:bottom-auto data-[place=inside]:mb-0 data-[place=inside]:after:hidden",
        (forceOpen || pickerOpen) && "pointer-events-auto opacity-100",
        "transition-opacity duration-(--duration-fast) group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100",
        isOwn ? "right-0 items-end" : "left-0 items-start",
      )}
    >
      <div
        role="toolbar"
        aria-label={t("chat.message_actions_aria")}
        className={REACTION_PILL}
      >
        <TooltipProvider delay={300}>
          {onToggleReaction ? (
            <>
              {QUICK_REACTIONS.map((emoji, index) => (
                <button
                  key={emoji}
                  type="button"
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-display-sm hover:bg-muted",
                    mine.has(emoji) && "bg-brand-subtle",
                    index >= 3 && "@max-xl/timeline:hidden",
                  )}
                  aria-label={t("chat.action_react_emoji", { emoji })}
                  aria-pressed={mine.has(emoji) ? true : undefined}
                  onClick={() => onToggleReaction(message, emoji)}
                >
                  <span aria-hidden>{emoji}</span>
                </button>
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
                triggerClassName="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground"
                iconClassName="size-4"
                icon={ChevronDown}
              />
            </>
          ) : (
            <MessageActionButton label={t("chat.action_react")} onClick={() => onReact?.(message)}>
              <FaceSlightlySmilingPlus className="size-5" aria-hidden />
            </MessageActionButton>
          )}
        </TooltipProvider>
      </div>

      <div role="menu" aria-label={t("chat.message_actions_aria")} className={CONTEXT_PANEL}>
        <ContextMenuRow label={t("chat.action_reply")} icon={Reply} onClick={() => onReply?.(message)} />
        {onPin ? (
          <ContextMenuRow label={pinLabel} icon={Pin} onClick={() => onPin(message)} />
        ) : null}
        <ContextMenuRow label={t("chat.action_copy")} icon={Copy} onClick={() => onCopy?.(message)} disabled={!onCopy} />
        {onForward && isForwardableChatMessage(message) ? (
          <ContextMenuRow label={t("chat.forward.action")} icon={Forward} onClick={() => onForward(message)} />
        ) : null}
        {canDelete ? (
          <ContextMenuRow
            label={t("chat.action_delete")}
            icon={Trash2}
            destructive
            onClick={() => onDelete?.(message)}
          />
        ) : null}
        {showSecondary ? <div role="separator" className="my-1 h-px bg-border" aria-hidden /> : null}
        {onThread ? (
          <ContextMenuRow label={t("chat.action_thread")} icon={MessageSquareText} onClick={() => onThread(message)} />
        ) : null}
        {canEdit && onEdit ? (
          <ContextMenuRow label={t("chat.action_edit")} icon={Pencil} onClick={() => onEdit(message)} />
        ) : null}
        {onFollowUp ? (
          <ContextMenuRow label={t("chat.follow_up.action")} icon={Bookmark} onClick={() => onFollowUp(message)} />
        ) : null}
        {onCreateTask ? (
          <ContextMenuRow
            label={t("chat.link.create_task")}
            icon={MODULE_ICONS.tasks}
            onClick={() => onCreateTask(message)}
          />
        ) : null}
        {onLinkTask ? (
          <ContextMenuRow label={t("chat.link.link_task")} icon={Link2} onClick={() => onLinkTask(message)} />
        ) : null}
        {isOwn ? <ChatSeenByContextRow message={message} /> : null}
      </div>
    </div>
  );
}
