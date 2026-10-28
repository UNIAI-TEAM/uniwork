"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { useChatRooms } from "@uniwork/core/chat";
import { mergeRoomMemberPermissions } from "@uniwork/core/chat/room-permissions-utils";
import { ChatMessageSelectionDialogs } from "./chat-message-selection-dialogs";
import type { ChatMessage } from "./chat-messages";
import { useChatMessageSelection } from "./use-chat-message-selection";
import {
  useChatMessageSelectionActions,
  type ChatMessageSelectionBarState,
} from "./use-chat-message-selection-actions";
import type { ChatMessageSelectionUi } from "./chat-message-selection-context";

/** Selection mode for one room panel: context value, row props, bar callback, dialogs. */
export function useChatPanelSelection({
  workspaceId,
  roomId,
  currentUserId,
  messages,
  canModerate,
  onSelectionChange,
}: {
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  messages: ChatMessage[];
  canModerate: boolean;
  onSelectionChange?: (bar: ChatMessageSelectionBarState | null) => void;
}): {
  selectionUi: ChatMessageSelectionUi | null;
  selectionActive: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (messageId: string) => void;
  dialogs: ReactNode;
} {
  const selection = useChatMessageSelection(roomId);
  const room = useChatRooms(workspaceId).data?.find((entry) => entry.id === roomId);
  const mayForward = canModerate || mergeRoomMemberPermissions(room?.member_permissions).allow_forward;
  const {
    selectionUi,
    bar: selectionBar,
    forwardingMessages,
    setForwardingMessages,
    deletingSelected,
    setDeletingSelected,
    confirmDeleteSelected,
    deletePending,
  } = useChatMessageSelectionActions({
    workspaceId,
    roomId,
    currentUserId,
    messages,
    selection,
    mayForward,
  });

  useEffect(() => {
    onSelectionChange?.(selectionBar);
    return () => onSelectionChange?.(null);
  }, [onSelectionChange, selectionBar]);

  const dialogs = useMemo(
    () => (
      <ChatMessageSelectionDialogs
        workspaceId={workspaceId}
        forwardingMessages={forwardingMessages}
        onForwardOpenChange={(open) => {
          if (!open) setForwardingMessages(null);
        }}
        onForwarded={selection.clear}
        deletingSelected={deletingSelected}
        onDeletingOpenChange={(open) => {
          if (!open && !deletePending) setDeletingSelected(null);
        }}
        onConfirmDelete={() => void confirmDeleteSelected()}
        deletePending={deletePending}
      />
    ),
    [
      confirmDeleteSelected,
      deletePending,
      deletingSelected,
      forwardingMessages,
      selection.clear,
      setDeletingSelected,
      setForwardingMessages,
      workspaceId,
    ],
  );

  return {
    selectionUi,
    selectionActive: selection.active,
    selectedIds: selection.selectedIds,
    onToggleSelect: selection.toggle,
    dialogs,
  };
}
