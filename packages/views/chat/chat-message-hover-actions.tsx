"use client";

import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Ellipsis, FaceSlightlySmilingPlus, Reply } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@uniwork/ui/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@uniwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { emojiPickerStrings } from "./chat-expression-utils";
import {
  CHAT_CONTEXT_PARTS,
  CHAT_DROPDOWN_PARTS,
  CHAT_MESSAGE_MENU_CLASS,
  ChatMessageMenuItems,
  type ChatMessageActionHandlers,
} from "./chat-message-menu-items";
import { useChatMessageSelectionUi } from "./chat-message-selection-context";
import { useActionsBarPlacement } from "./use-actions-bar-placement";

/**
 * The column a message's bubble and its extras sit in. The actions bar floats
 * beside it (absolute), so the rail itself only lines the column up with the
 * sender's side.
 */
export function chatMessageActionsRailClass(isOwn: boolean): string {
  return cn("flex w-fit max-w-full flex-col", isOwn ? "self-end" : "self-start");
}

/** The reaction a hover gives in one click, as Telegram's heart. */
const QUICK_REACTION = "❤️";

/** Vertical stack on heart hover (canvas / Telegram-style quick picker). */
export const HEART_HOVER_REACTIONS = ["👍", "😄", "😢"] as const;

const HEART_STACK_BUTTON =
  "size-9 min-h-9 shrink-0 rounded-full p-0 text-title-sm leading-none hover:bg-muted aria-pressed:bg-brand-subtle";

/** The bar's 32px round buttons (the primitive grows them to 44px on a coarse pointer). */
const BAR_BUTTON =
  "size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground aria-expanded:bg-brand-subtle aria-expanded:text-brand-subtle-foreground aria-pressed:bg-brand-subtle";

/** A bar button past the heart while only the pointer is near: no size, back to 32px under keyboard focus. */
const FOLDED =
  "size-0 overflow-hidden border-0 p-0 opacity-0 pointer-coarse:min-h-0 pointer-coarse:min-w-0 group-has-[:focus-visible]/message:ml-0.5 group-has-[:focus-visible]/message:size-8 group-has-[:focus-visible]/message:opacity-100";

// The composer's emoji set (search, categories, recently used), loaded on first open.
const EmojiPicker = lazy(() =>
  import("@uniwork/ui/components/common/emoji-picker").then((module) => ({
    default: module.EmojiPicker,
  })),
);

/**
 * "Thêm cảm xúc": any emoji beyond the quick ones, from a popover picker. The
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
  triggerClassName = BAR_BUTTON,
  iconClassName = "size-4.5",
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
  pressed,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
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
            variant="ghost"
            size="icon-lg"
            className={cn(BAR_BUTTON, className)}
            aria-label={label}
            aria-pressed={pressed ? true : undefined}
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

function QuickHeartReactionStack({
  message,
  mine,
  onToggleReaction,
}: {
  message: ChatMessage;
  mine: Set<string>;
  onToggleReaction: (message: ChatMessage, emoji: string) => void;
}) {
  const { t } = useTranslation();
  const heartLabel = t("chat.action_react_emoji", { emoji: QUICK_REACTION });
  const [stackOpen, setStackOpen] = useState(false);
  const [heartTooltipOpen, setHeartTooltipOpen] = useState(false);
  return (
    <div
      className="group/heart relative shrink-0"
      onMouseEnter={() => {
        setStackOpen(true);
        setHeartTooltipOpen(false);
      }}
      onMouseLeave={() => setStackOpen(false)}
      onFocusCapture={() => setStackOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setStackOpen(false);
        }
      }}
    >
      <div
        className={cn(
          "absolute bottom-full left-1/2 z-30 mb-1 flex -translate-x-1/2 flex-col items-stretch gap-0.5 rounded-full border border-border bg-popover p-1 shadow-floating",
          "pointer-events-none opacity-0 transition-opacity duration-(--duration-fast)",
          "group-hover/heart:pointer-events-auto group-hover/heart:opacity-100",
          "group-focus-within/heart:pointer-events-auto group-focus-within/heart:opacity-100",
        )}
        role="group"
        aria-hidden={stackOpen ? undefined : true}
        aria-label={t("chat.action_react_more")}
      >
        {HEART_HOVER_REACTIONS.map((emoji) => (
          <Button
            key={emoji}
            type="button"
            variant="ghost"
            size="icon-lg"
            className={HEART_STACK_BUTTON}
            aria-label={t("chat.action_react_emoji", { emoji })}
            aria-pressed={mine.has(emoji) ? true : undefined}
            onClick={() => onToggleReaction(message, emoji)}
          >
            <span aria-hidden className="text-body-lg leading-none">
              {emoji}
            </span>
          </Button>
        ))}
      </div>
      <Tooltip
        open={stackOpen ? false : heartTooltipOpen}
        onOpenChange={(next) => {
          if (!stackOpen) setHeartTooltipOpen(next);
        }}
      >
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className={BAR_BUTTON}
              aria-label={heartLabel}
              aria-pressed={mine.has(QUICK_REACTION) ? true : undefined}
              onClick={() => onToggleReaction(message, QUICK_REACTION)}
            >
              <span aria-hidden className="text-body-lg leading-none">
                {QUICK_REACTION}
              </span>
            </Button>
          }
        />
        <TooltipContent>{heartLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

type PickerState = { pickerOpen: boolean; setPickerOpen: (open: boolean) => void };

/** The frame's picker: the right-click menu's "Thêm cảm xúc" opens the bar's picker. */
const MessagePickerContext = createContext<PickerState | null>(null);

/** The bar's buttons the roving focus walks: one css-hidden (display: none) cannot take focus, so it is skipped. */
function rovingButtons(bar: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(bar?.querySelectorAll<HTMLButtonElement>("button") ?? []).filter(
    (button) => getComputedStyle(button).display !== "none",
  );
}

/** What the frame hands its descendants so an in-bubble "…" can open the same menu as the bar's. */
type MessageMenuState = { message: ChatMessage; isOwn: boolean; canEdit: boolean; handlers: ChatMessageActionHandlers };
const MessageMenuContext = createContext<MessageMenuState | null>(null);

type ActionsProps = ChatMessageActionHandlers & {
  message: ChatMessage;
  isOwn: boolean;
  /** When false the edit item is left out (someone else's message, a call log, a file). */
  canEdit?: boolean;
  /** Over the message's own top corner instead of beside it: an album photo has neighbours. */
  overlay?: boolean;
};

/**
 * What hovering a message shows, as Telegram: one round quick-heart beside the
 * bubble; reply and the rest live in the right-click menu. Keyboard focus (or
 * an open picker or menu) widens it to the whole bar — any emoji, reply, and
 * "…" for that same menu — since a keyboard has no right click. It sits beside
 * the bubble when the timeline is wide and above it when narrow (a side
 * thread), so it never covers the message above.
 */
export function ChatMessageHoverActions({ message, isOwn, canEdit = true, overlay = false, ...handlers }: ActionsProps) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const shared = useContext(MessagePickerContext);
  const selection = useChatMessageSelectionUi();
  const [ownPickerOpen, setOwnPickerOpen] = useState(false);
  const pickerOpen = shared ? shared.pickerOpen : ownPickerOpen;
  const setPickerOpen = shared ? shared.setPickerOpen : setOwnPickerOpen;
  const [menuOpen, setMenuOpen] = useState(false);
  const { onReply, onReact, onToggleReaction } = handlers;
  const canInteract = Boolean(onReply && onReact) && !selection?.active;
  useActionsBarPlacement(barRef, canInteract);

  if (!canInteract) return null;

  // One tab stop per message: Tab enters on the first action, arrows move
  // along the bar (roving tabindex), so a long thread is not dozens of stops.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = rovingButtons(barRef.current);
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
  // Past the heart, the bar waits for the keyboard or for its own popup. The
  // rest fold to nothing rather than display:none, so they keep their place in
  // the roving tab order and the accessibility tree; focusing one unfolds them.
  const extra = pickerOpen || menuOpen ? "ml-0.5" : FOLDED;
  // A document card's actions live only in the menu: its "…" stays unfolded
  // on hover so a mouse finds them without a right click. On a coarse pointer
  // the card carries its own "…" (ChatMessageTouchMore) for the same menu, so
  // the bar's is hidden there instead of showing two "Thêm" side by side.
  const moreExtra = handlers.documentItems ? "ml-0.5 pointer-coarse:hidden" : extra;

  return (
    // Hidden until the message is hovered or focused (or one of its popups is
    // open). Wide timeline (--bar-mode: side): beside the bubble, with an
    // invisible ::before bridging the gap so the pointer can reach it. Narrow:
    // above the bubble, or inside its top edge when there is no room
    // (use-actions-bar-placement).
    <div
      ref={barRef}
      role="toolbar"
      aria-label={t("chat.message_actions_aria")}
      data-message-actions
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      className={cn(
        "pointer-events-none absolute z-10 flex w-max items-center rounded-full border border-border bg-popover p-0.5 opacity-0 shadow-floating",
        // Keyboard focus (focus-visible) reveals the bar; a tap's focus-within does
        // not: it would flash the bar over the card the finger just hit (UNI-1966 F-01).
        "transition-opacity duration-(--duration-fast) group-has-[:focus-visible]/message:pointer-events-auto group-has-[:focus-visible]/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100",
        (pickerOpen || menuOpen) && "pointer-events-auto opacity-100",
        overlay
          ? cn("[--bar-mode:side] top-1.5", isOwn ? "right-1.5" : "left-1.5")
          : cn(
              // Wide: beside the bubble's last line, on the free side.
              "[--bar-mode:side] bottom-0 before:absolute before:inset-y-0 before:w-2.5 before:content-['']",
              isOwn ? "right-full mr-2 before:left-full" : "left-full ml-2 before:right-full",
              // Narrow: above the bubble, as before; inside its top edge when there is no room.
              "@max-2xl/timeline:[--bar-mode:above] @max-2xl/timeline:bottom-full @max-2xl/timeline:mb-1.5 @max-2xl/timeline:mr-0 @max-2xl/timeline:ml-0 @max-2xl/timeline:before:hidden",
              isOwn ? "@max-2xl/timeline:right-0" : "@max-2xl/timeline:left-0",
              "data-[place=inside]:bottom-auto data-[place=inside]:mb-0",
            ),
      )}
    >
      <TooltipProvider delay={300}>
        {onToggleReaction ? (
          <QuickHeartReactionStack message={message} mine={mine} onToggleReaction={onToggleReaction} />
        ) : null}
        {onToggleReaction ? (
          <MessageReactionPicker
            label={t("chat.action_react_more")}
            align={isOwn ? "end" : "start"}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onPick={(emoji) => {
              onToggleReaction(message, emoji);
              setPickerOpen(false);
            }}
            triggerClassName={cn(BAR_BUTTON, extra)}
          />
        ) : (
          <MessageActionButton label={t("chat.action_react")} onClick={() => onReact?.(message)}>
            <FaceSlightlySmilingPlus className="size-4" aria-hidden />
          </MessageActionButton>
        )}
        <MessageActionButton label={t("chat.action_reply")} onClick={() => onReply?.(message)} className={extra}>
          <Reply className="size-4" aria-hidden />
        </MessageActionButton>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className={cn(BAR_BUTTON, moreExtra)}
                aria-label={t("chat.action_more")}
              >
                <Ellipsis className="size-4" aria-hidden />
              </Button>
            }
          />
          <DropdownMenuContent align={isOwn ? "end" : "start"} className={CHAT_MESSAGE_MENU_CLASS}>
            <ChatMessageMenuItems
              parts={CHAT_DROPDOWN_PARTS}
              message={message}
              isOwn={isOwn}
              canEdit={canEdit}
              onMoreReactions={() => setPickerOpen(true)}
              {...handlers}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  );
}

/**
 * The "…" a card carries inside its own bubble, for a pointer that cannot
 * hover: the bar above is hover-or-keyboard only, so on touch the menu was
 * reachable by long press alone. It opens the same menu as the bar's "…" and
 * shows only on a coarse pointer (the primitive grows it to 44px there); a
 * fine pointer keeps the hover bar. Renders nothing outside a frame.
 */
export function ChatMessageTouchMore({ className }: { className?: string }) {
  const { t } = useTranslation();
  const menu = useContext(MessageMenuContext);
  const picker = useContext(MessagePickerContext);
  if (!menu) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn("hidden size-8 shrink-0 rounded-full pointer-coarse:inline-flex", className)}
            aria-label={t("chat.action_more")}
          >
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align={menu.isOwn ? "end" : "start"} className={CHAT_MESSAGE_MENU_CLASS}>
        <ChatMessageMenuItems
          parts={CHAT_DROPDOWN_PARTS}
          message={menu.message}
          isOwn={menu.isOwn}
          canEdit={menu.canEdit}
          onMoreReactions={() => picker?.setPickerOpen(true)}
          {...menu.handlers}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A message's bubble column with its actions: a right click (a long press on
 * touch) opens the full menu at the pointer, and hovering shows the small bar
 * (ChatMessageHoverActions), drawn here as the column's last child. A message
 * not on the server yet (`pending`) has nothing to act on: just the column.
 */
export function ChatMessageActionsFrame({
  message,
  isOwn,
  canEdit = true,
  overlay = false,
  pending = false,
  className,
  children,
  ...handlers
}: ActionsProps & { pending?: boolean; className?: string; children: ReactNode }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = useMemo(() => ({ pickerOpen, setPickerOpen }), [pickerOpen]);
  const selection = useChatMessageSelectionUi();
  const menuState: MessageMenuState = { message, isOwn, canEdit, handlers };
  const frame = cn("group/message relative", className);
  const selectionActive = Boolean(selection?.active);
  const hasMenu =
    !pending && (selectionActive || Boolean(handlers.onReply && handlers.onReact) || Boolean(selection));
  if (!hasMenu) return <div className={frame}>{children}</div>;
  return (
    <MessagePickerContext.Provider value={picker}>
      <MessageMenuContext.Provider value={menuState}>
        <ContextMenu>
          {/* The trigger's own select-none would stop copying a message's text. */}
          <ContextMenuTrigger className={cn(frame, "select-text")}>
            {children}
            <ChatMessageHoverActions message={message} isOwn={isOwn} canEdit={canEdit} overlay={overlay} {...handlers} />
          </ContextMenuTrigger>
          <ContextMenuContent className={CHAT_MESSAGE_MENU_CLASS}>
            <ChatMessageMenuItems
              parts={CHAT_CONTEXT_PARTS}
              message={message}
              isOwn={isOwn}
              canEdit={canEdit}
              onMoreReactions={() => setPickerOpen(true)}
              {...handlers}
            />
          </ContextMenuContent>
        </ContextMenu>
      </MessageMenuContext.Provider>
    </MessagePickerContext.Provider>
  );
}
