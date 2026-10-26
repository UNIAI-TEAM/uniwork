"use client";

import { useContext, type ComponentType, type ReactNode } from "react";
import {
  Bookmark,
  Copy,
  FaceSlightlySmilingPlus,
  Forward,
  Link2,
  MessageSquareText,
  Pencil,
  Pin,
  Reply,
  Trash,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@uniwork/ui/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_ICONS } from "../layout/module-icons";
import { ChatForwardContext, isForwardableChatMessage } from "./chat-forward-context";
import type { ChatMessage } from "./chat-messages";
import { ChatSeenByMenuItem } from "./chat-seen-by";

/**
 * The right-click menu and the "…" dropdown are two Base UI namespaces with
 * the same shape (as tasks/row-actions-items does it): the message's items
 * are written once against this map and rendered through either.
 */
export type ChatMenuParts = {
  Item: ComponentType<{
    onClick?: () => void;
    variant?: "default" | "destructive";
    disabled?: boolean;
    className?: string;
    "aria-label"?: string;
    children: ReactNode;
  }>;
  Separator: ComponentType;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
  SubContent: ComponentType<{ className?: string; children: ReactNode }>;
};

export const CHAT_CONTEXT_PARTS: ChatMenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export const CHAT_DROPDOWN_PARTS: ChatMenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

/** The menu's rows, the seen-by row among them: 36px, 10px corners, 18px glyphs (canvas). */
export const CHAT_MESSAGE_MENU_CLASS = cn(
  "min-w-56 rounded-[14px] p-1.5",
  // The role menu of a document card is tall: never past the viewport less a 0.5rem margin, scrolling inside (UNI-2012 V1-F8).
  "max-h-[min(var(--available-height),calc(100dvh-1rem))]",
  "[&>[data-slot$=menu-item]]:min-h-9 [&>[data-slot$=menu-item]]:gap-3 [&>[data-slot$=menu-item]]:rounded-control [&>[data-slot$=menu-item]]:px-2.5",
  "[&>[data-slot$=menu-sub-trigger]]:min-h-9 [&>[data-slot$=menu-sub-trigger]]:gap-3 [&>[data-slot$=menu-sub-trigger]]:rounded-control [&>[data-slot$=menu-sub-trigger]]:px-2.5",
  // A document card's menu (reactions, five document rows, reply group, follow-up group, delete, seen-by) is ~920px:
  // on a short viewport the rows tighten to 32px so the whole menu fits instead of cutting the last row.
  "[@media(max-height:960px)]:[&>[data-slot$=menu-item]]:min-h-8 [@media(max-height:960px)]:[&>[data-slot$=menu-sub-trigger]]:min-h-8",
);

/** The quick reactions, Telegram's strip at the head of the menu. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"] as const;

const EMOJI_ITEM =
  "size-9 min-h-9 shrink-0 justify-center rounded-full p-0 text-title-sm leading-none data-highlighted:scale-110 transition-transform duration-(--duration-fast)";

/** Everything a message offers; each handler absent leaves its item out. */
export type ChatMessageActionHandlers = {
  onReply?: (message: ChatMessage) => void;
  onReact?: (message: ChatMessage) => void;
  /** When set, the menu leads with the quick reactions. */
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onPin?: (message: ChatMessage) => void;
  onCopy?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onCreateTask?: (message: ChatMessage) => void;
  onLinkTask?: (message: ChatMessage) => void;
  onFollowUp?: (message: ChatMessage) => void;
  /**
   * What the message's attachment offers (a document card's role menu),
   * written once against the parts so the right-click menu and the "…"
   * dropdown both carry it. One keyed node per entry, null for an entry the
   * reader does not get; with no entry left the group (and its separator)
   * is left out.
   */
  documentItems?: (parts: ChatMenuParts) => ReactNode[];
};

/**
 * A message's menu, Telegram's order: the reaction strip, then what the
 * attachment offers (a document's own actions), then what you do
 * with the message (reply, thread, edit, copy, pin, forward), then what it
 * becomes in UniWork (follow up, a task), then delete apart, and who has seen
 * your own message last.
 */
export function ChatMessageMenuItems({
  parts: P,
  message,
  isOwn,
  canEdit,
  onMoreReactions,
  onReply,
  onToggleReaction,
  onThread,
  onEdit,
  onPin,
  onCopy,
  onDelete,
  onCreateTask,
  onLinkTask,
  onFollowUp,
  documentItems,
}: ChatMessageActionHandlers & {
  parts: ChatMenuParts;
  message: ChatMessage;
  isOwn: boolean;
  canEdit: boolean;
  /** "Thêm cảm xúc": opens the full emoji picker by the message. */
  onMoreReactions: () => void;
}) {
  const { t } = useTranslation();
  const onForward = useContext(ChatForwardContext);
  const mine = new Set(message.myReactions ?? []);
  const workHub = Boolean(onCreateTask || onLinkTask || onFollowUp);
  const attachment = (documentItems?.(P) ?? []).filter((item) => item != null && item !== false);
  return (
    <>
      {onToggleReaction ? (
        <>
          <div className="flex items-center gap-0.5 pb-1">
            {QUICK_REACTIONS.map((emoji) => (
              <P.Item
                key={emoji}
                aria-label={t("chat.action_react_emoji", { emoji })}
                className={cn(EMOJI_ITEM, mine.has(emoji) && "bg-brand-subtle")}
                onClick={() => onToggleReaction(message, emoji)}
              >
                <span aria-hidden>{emoji}</span>
              </P.Item>
            ))}
            <P.Item
              aria-label={t("chat.action_react_more")}
              className={cn(EMOJI_ITEM, "text-muted-foreground [&_svg]:size-5")}
              onClick={onMoreReactions}
            >
              <FaceSlightlySmilingPlus aria-hidden />
            </P.Item>
          </div>
          <P.Separator />
        </>
      ) : null}
      {attachment.length > 0 ? (
        <>
          {attachment}
          <P.Separator />
        </>
      ) : null}
      <P.Item onClick={() => onReply?.(message)} disabled={!onReply}>
        <Reply className="size-4" aria-hidden />
        {t("chat.action_reply")}
      </P.Item>
      {onThread ? (
        <P.Item onClick={() => onThread(message)}>
          <MessageSquareText className="size-4" aria-hidden />
          {t("chat.action_thread")}
        </P.Item>
      ) : null}
      {canEdit && onEdit ? (
        <P.Item onClick={() => onEdit(message)}>
          <Pencil className="size-4" aria-hidden />
          {t("chat.action_edit")}
        </P.Item>
      ) : null}
      <P.Item onClick={() => onCopy?.(message)} disabled={!onCopy}>
        <Copy className="size-4" aria-hidden />
        {t("chat.action_copy")}
      </P.Item>
      {onPin ? (
        <P.Item onClick={() => onPin(message)}>
          <Pin className="size-4" aria-hidden />
          {message.pinned ? t("chat.action_unpin") : t("chat.action_pin")}
        </P.Item>
      ) : null}
      {onForward && isForwardableChatMessage(message) ? (
        <P.Item onClick={() => onForward(message)}>
          <Forward className="size-4" aria-hidden />
          {t("chat.forward.action")}
        </P.Item>
      ) : null}
      {workHub ? (
        <>
          <P.Separator />
          <P.Item onClick={() => onFollowUp?.(message)} disabled={!onFollowUp}>
            <Bookmark className="size-4" aria-hidden />
            {t("chat.follow_up.action")}
          </P.Item>
          <P.Item onClick={() => onCreateTask?.(message)} disabled={!onCreateTask}>
            <MODULE_ICONS.tasks className="size-4.5" aria-hidden />
            {t("chat.link.create_task")}
          </P.Item>
          <P.Item onClick={() => onLinkTask?.(message)} disabled={!onLinkTask}>
            <Link2 className="size-4" aria-hidden />
            {t("chat.link.link_task")}
          </P.Item>
        </>
      ) : null}
      {isOwn && onDelete ? (
        <>
          <P.Separator />
          <P.Item variant="destructive" onClick={() => onDelete(message)}>
            <Trash className="size-4" aria-hidden />
            {t("chat.action_delete")}
          </P.Item>
        </>
      ) : null}
      {isOwn ? <ChatSeenByMenuItem message={message} parts={P} /> : null}
    </>
  );
}
