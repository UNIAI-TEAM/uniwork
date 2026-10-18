"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useDeleteChatMessage, useToggleChatMessagePin, useToggleChatReaction } from "@uniwork/core/chat";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { CHAT_CONFIRM_CLASS } from "./chat-confirm-look";
import { toastChatError } from "./chat-error-message";
import { formatMessageTime } from "./chat-message-time";
import { replyPreviewLabel } from "./chat-reply-quote";
import { parseChatMediaMessageBody } from "./chat-expression-utils";
import type { ChatMessage } from "./chat-messages";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import type { NativeChatMessageActions } from "./native-chat-message-item";

/** Focus a message's article (it carries tabIndex=-1), or report that it is not on screen. */
export function focusChatMessage(messageId: string): boolean {
  const node = document.getElementById(`chat-msg-${messageId}`);
  if (!node) return false;
  node.focus({ preventScroll: true });
  return true;
}

/**
 * Every action a message offers, wired to its mutation with a failure the
 * person can see: nothing here fails silently. Delete asks first; edit hands
 * the message to the composer (`onEditMessage`), which saves it.
 */
export function useNativeChatMessageActions({
  workspaceId,
  roomId,
  currentUserId,
  messages,
  replyTo,
  onReplyToChange,
  threadsEnabled,
  threadRootId,
  onOpenThread,
  onCloseThread,
  onJumpToMessage,
  onFocusComposer,
  taskLinkActions,
  onFollowUp,
  onEditMessage,
}: {
  workspaceId: string;
  roomId: string;
  /** Names my message "Bạn" in the delete confirmation's quote. */
  currentUserId?: string;
  messages: ChatMessage[];
  replyTo: ChatMessage | null;
  onReplyToChange: (message: ChatMessage | null) => void;
  threadsEnabled: boolean;
  threadRootId: string | null;
  onOpenThread: (message: ChatMessage) => void;
  onCloseThread: () => void;
  onJumpToMessage: (messageId: string) => void;
  onFocusComposer?: () => void;
  taskLinkActions?: { onCreateTask?: (message: ChatMessage) => void; onLinkTask?: (message: ChatMessage) => void } | null;
  onFollowUp?: (message: ChatMessage) => void;
  /** Puts the composer into edit mode for the message. */
  onEditMessage: (message: ChatMessage) => void;
}): { actions: NativeChatMessageActions; dialogs: ReactNode } {
  const { t, i18n } = useTranslation();
  // mutateAsync is stable across renders; the mutation objects are not.
  const toggleReactionAsync = useToggleChatReaction(workspaceId).mutateAsync;
  const deleteMessage = useDeleteChatMessage(workspaceId);
  const togglePinAsync = useToggleChatMessagePin(workspaceId).mutateAsync;
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);

  // Handlers read the latest list and reply target through refs, so the
  // action object stays the same between renders and memoised rows skip.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const threadRootIdRef = useRef(threadRootId);
  threadRootIdRef.current = threadRootId;

  const react = useCallback(
    (message: ChatMessage, emoji: string) => {
      toggleReactionAsync({ roomId, messageId: message.id, emoji }).catch((err: unknown) => {
        toastChatError(err, t, t("chat.message_list.react_failed"));
      });
    },
    [roomId, t, toggleReactionAsync],
  );

  const onReply = useCallback(
    (message: ChatMessage | null) => {
      onReplyToChange(message);
      if (message) onFocusComposer?.();
    },
    [onFocusComposer, onReplyToChange],
  );

  const onThread = useCallback(
    (message: ChatMessage) => {
      if (!threadsEnabled) return;
      onOpenThread(message);
      // useChatCatchUpUi marks the open thread read and keeps the old pointer.
      onFocusComposer?.();
    },
    [onFocusComposer, onOpenThread, threadsEnabled],
  );

  const onPin = useCallback(
    (message: ChatMessage) => {
      togglePinAsync({ roomId, messageId: message.id }).catch((err: unknown) => {
        toastChatError(
          err,
          t,
          message.pinned ? t("chat.message_list.unpin_failed") : t("chat.message_list.pin_failed"),
        );
      });
    },
    [roomId, t, togglePinAsync],
  );

  const onCopy = useCallback(
    async (message: ChatMessage) => {
      try {
        // A sticker or GIF copies as its link, not as its markdown.
        await navigator.clipboard.writeText(parseChatMediaMessageBody(message.body)?.url ?? message.body);
        toast.success(t("chat.message_list.copied"));
      } catch {
        toast.error(t("chat.message_list.copy_failed"));
      }
    },
    [t],
  );

  const actions = useMemo<NativeChatMessageActions>(
    () => ({
      onReply,
      onReact: (message) => react(message, DEFAULT_QUICK_REACTION),
      onToggleReaction: react,
      onJumpToMessage,
      onThread: threadsEnabled ? onThread : undefined,
      onEdit: onEditMessage,
      onPin,
      onCopy: (message) => void onCopy(message),
      onDelete: setDeleting,
      onCreateTask: taskLinkActions?.onCreateTask,
      onLinkTask: taskLinkActions?.onLinkTask,
      onFollowUp,
    }),
    [onCopy, onEditMessage, onFollowUp, onJumpToMessage, onPin, onReply, onThread, react, taskLinkActions, threadsEnabled],
  );

  const confirmDelete = async () => {
    const message = deleting;
    if (!message) return;
    const list = messagesRef.current;
    const index = list.findIndex((item) => item.id === message.id);
    const neighbour = list[index + 1] ?? list[index - 1];
    try {
      await deleteMessage.mutateAsync({ roomId, messageId: message.id });
      setDeleting(null);
      if (replyToRef.current?.id === message.id) onReplyToChange(null);
      if (threadRootIdRef.current === message.id) onCloseThread();
      // The deleted row was where focus was; put it on the message beside
      // it, or back in the composer when the room is now empty.
      window.requestAnimationFrame(() => {
        if (!neighbour || !focusChatMessage(neighbour.id)) onFocusComposer?.();
      });
    } catch (err) {
      setDeleting(null);
      toastChatError(err, t, t("chat.message_list.delete_failed"));
    }
  };

  const pending = deleteMessage.isPending;
  // The message being deleted, quoted under the question, so it is clear which one goes (canvas).
  const quoteMeta = deleting
    ? [deleting.sender === currentUserId ? t("chat.you") : null, formatMessageTime(deleting.ts, i18n.language)]
        .filter(Boolean)
        .join(" · ")
    : "";
  const dialogs = (
    <AlertDialog
      open={deleting != null}
      onOpenChange={(open) => {
        if (!open && !pending) setDeleting(null);
      }}
    >
      <AlertDialogContent className={cn(CHAT_CONFIRM_CLASS, "sm:max-w-100")}>
        <AlertDialogHeader>
          <IconTile icon={Trash2} tone="destructive" className="mb-2.5" />
          <AlertDialogTitle>{t("chat.message_list.delete_confirm_title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("chat.message_list.delete_confirm_description")}</AlertDialogDescription>
        </AlertDialogHeader>
        {deleting ? (
          <blockquote className="min-w-0 rounded-[10px] border-l-3 border-brand/30 bg-muted px-3 py-2 text-body text-foreground">
            <span className="block text-caption font-semibold text-brand tabular-nums">{quoteMeta}</span>
            <span className="line-clamp-2 [overflow-wrap:anywhere]">
              {replyPreviewLabel(deleting, {
                voice: t("chat.voice_message"),
                file: t("chat.file_untitled"),
                media: { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.media_image") },
              })}
            </span>
          </blockquote>
        ) : null}
        <AlertDialogFooter>
          {/* aria-disabled, not disabled: both stay in the tab order while it runs (ConfirmDialog's rule). */}
          <AlertDialogCancel variant="secondary" aria-disabled={pending || undefined}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructiveSolid"
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={() => void confirmDelete()}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t("chat.action_delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { actions, dialogs };
}
