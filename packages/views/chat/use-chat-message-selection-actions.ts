"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDeleteChatMessage } from "@uniwork/core/chat";
import { isForwardableChatMessage } from "./chat-forward-context";
import type { ChatMessageSelectionUi } from "./chat-message-selection-context";
import { toastChatError } from "./chat-error-message";
import { parseChatMediaMessageBody } from "./chat-expression-utils";
import type { ChatMessage } from "./chat-messages";
import {
  joinSelectedChatMessageText,
  type ChatMessageSelection,
} from "./use-chat-message-selection";

export type ChatMessageSelectionBarState = {
  active: boolean;
  count: number;
  canForward: boolean;
  canDelete: boolean;
  busy: boolean;
  clear: () => void;
  copy: () => void;
  forward: () => void;
  deleteSelected: () => void;
};

function messageCopyText(message: { body: string }): string {
  return parseChatMediaMessageBody(message.body)?.url ?? message.body;
}

/**
 * Bulk copy / forward / delete for the timeline's multi-select, plus the
 * value the message menus and selection bar share.
 */
export function useChatMessageSelectionActions({
  workspaceId,
  roomId,
  currentUserId,
  messages,
  selection,
  mayForward,
}: {
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  messages: ChatMessage[];
  selection: ChatMessageSelection;
  mayForward: boolean;
}): {
  selectionUi: ChatMessageSelectionUi | null;
  bar: ChatMessageSelectionBarState | null;
  forwardingMessages: ChatMessage[] | null;
  setForwardingMessages: (messages: ChatMessage[] | null) => void;
  deletingSelected: ChatMessage[] | null;
  setDeletingSelected: (messages: ChatMessage[] | null) => void;
  confirmDeleteSelected: () => Promise<void>;
  deletePending: boolean;
} {
  const { t } = useTranslation();
  const deleteMessage = useDeleteChatMessage(workspaceId);
  const [forwardingMessages, setForwardingMessages] = useState<ChatMessage[] | null>(null);
  const [deletingSelected, setDeletingSelected] = useState<ChatMessage[] | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedMessages = useMemo(
    () => messages.filter((message) => selection.selectedIds.has(message.id)),
    [messages, selection.selectedIds],
  );

  const canForwardSelected = mayForward && selectedMessages.some(isForwardableChatMessage);
  const canDeleteSelected = selectedMessages.some((message) => message.sender === currentUserId);

  const copySelected = useCallback(() => {
    const text = joinSelectedChatMessageText(selectedMessages, selection.selectedIds, messageCopyText);
    if (!text) {
      toast.error(t("chat.message_list.copy_failed"));
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("chat.message_list.copied")),
      () => toast.error(t("chat.message_list.copy_failed")),
    );
  }, [selectedMessages, selection.selectedIds, t]);

  const forwardSelected = useCallback(() => {
    const forwardable = selectedMessages.filter(isForwardableChatMessage);
    if (forwardable.length === 0) {
      toast.error(t("chat.forward.kind_refused"));
      return;
    }
    setForwardingMessages(forwardable);
  }, [selectedMessages, t]);

  const deleteSelected = useCallback(() => {
    const own = selectedMessages.filter((message) => message.sender === currentUserId);
    if (own.length === 0) return;
    setDeletingSelected(own);
  }, [currentUserId, selectedMessages]);

  const confirmDeleteSelected = useCallback(async () => {
    const targets = deletingSelected;
    if (!targets || targets.length === 0) return;
    setBusy(true);
    try {
      for (const message of targets) {
        await deleteMessage.mutateAsync({ roomId, messageId: message.id });
      }
      setDeletingSelected(null);
      selection.clear();
      toast.success(t("chat.selection.deleted", { count: targets.length }));
    } catch (err) {
      toastChatError(err, t, t("chat.message_list.delete_failed"));
    } finally {
      setBusy(false);
    }
  }, [deleteMessage, deletingSelected, roomId, selection, t]);

  const enter = useCallback(
    (message: ChatMessage) => {
      selection.enter(message.id);
    },
    [selection],
  );

  const selectionUi = useMemo<ChatMessageSelectionUi | null>(() => {
    if (!selection.active && selection.selectedIds.size === 0) {
      // Still expose enter so the menu's "Select" item works before any selection.
      return {
        active: false,
        selectedIds: selection.selectedIds,
        enter,
        toggle: selection.toggle,
        clear: selection.clear,
        copySelected,
        forwardSelected,
        deleteSelected,
        canForwardSelected: false,
        canDeleteSelected: false,
      };
    }
    return {
      active: selection.active,
      selectedIds: selection.selectedIds,
      enter,
      toggle: selection.toggle,
      clear: selection.clear,
      copySelected,
      forwardSelected,
      deleteSelected,
      canForwardSelected,
      canDeleteSelected,
    };
  }, [
    canDeleteSelected,
    canForwardSelected,
    copySelected,
    deleteSelected,
    enter,
    forwardSelected,
    selection.active,
    selection.clear,
    selection.selectedIds,
    selection.toggle,
  ]);

  const bar = useMemo<ChatMessageSelectionBarState | null>(() => {
    if (!selection.active) return null;
    return {
      active: true,
      count: selection.selectedIds.size,
      canForward: canForwardSelected,
      canDelete: canDeleteSelected,
      busy: busy || deleteMessage.isPending,
      clear: selection.clear,
      copy: copySelected,
      forward: forwardSelected,
      deleteSelected,
    };
  }, [
    busy,
    canDeleteSelected,
    canForwardSelected,
    copySelected,
    deleteMessage.isPending,
    deleteSelected,
    forwardSelected,
    selection.active,
    selection.clear,
    selection.selectedIds.size,
  ]);

  return {
    selectionUi,
    bar,
    forwardingMessages,
    setForwardingMessages,
    deletingSelected,
    setDeletingSelected,
    confirmDeleteSelected,
    deletePending: busy || deleteMessage.isPending,
  };
}
