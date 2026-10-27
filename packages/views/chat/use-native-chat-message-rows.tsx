"use client";

import { useCallback, useMemo } from "react";
import type { ChatMessage } from "./chat-messages";
import type { ChatDocumentDesktopOpen } from "./chat-document-menu";
import type { NameContextEntry } from "./native-chat-message-mapping";
import {
  NativeChatMessageItem,
  layoutNativeChatMessages,
  type NativeChatMessageActions,
  type NativeChatMessageContext,
} from "./native-chat-message-item";
import { virtualChatRowEstimatePx, virtualChatRowMeasureKey } from "./virtual-chat-message-list";

/**
 * The timeline's rows: lays the messages out (grouping, sender labels, read
 * receipts) and hands the virtual list its key, size estimate and renderer
 * for each index, plus the sender label the live region reads out.
 */
export function useNativeChatMessageRows({
  messages,
  workspaceId,
  roomId,
  currentUserId,
  youLabel,
  nameContext,
  showSenderName,
  canPinMessages,
  canModerate,
  actions,
  desktopOpen,
  receiptReadAt,
  unreadSince,
  threadRoot,
  highlightMessageId,
  openThreadRootId,
  selectionActive = false,
  selectedIds,
  onToggleSelect,
}: {
  messages: ChatMessage[];
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  youLabel: string;
  nameContext: NameContextEntry[];
  showSenderName: boolean;
  canPinMessages: boolean;
  canModerate: boolean;
  actions: NativeChatMessageActions;
  desktopOpen: ChatDocumentDesktopOpen | undefined;
  /** The peer's read pointer, or null inside a thread (no "Đã xem" there). */
  receiptReadAt: string | null;
  unreadSince: string | null;
  threadRoot: ChatMessage | null;
  highlightMessageId: string | null;
  openThreadRootId: string | null;
  selectionActive?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (messageId: string) => void;
}) {
  const layout = useMemo(
    () =>
      layoutNativeChatMessages(messages, {
        currentUserId,
        youLabel,
        nameContext,
        peerLastReadAt: receiptReadAt,
        unreadSince,
        threadRoot: threadRoot ? { id: threadRoot.id, replyCount: Math.max(threadRoot.replyCount ?? 0, messages.length - 1) } : null,
      }),
    [currentUserId, messages, nameContext, receiptReadAt, threadRoot, unreadSince, youLabel],
  );
  const rowContext = useMemo<NativeChatMessageContext>(
    () => ({
      workspaceId,
      roomId,
      currentUserId,
      youLabel,
      nameContext,
      showSenderName,
      inThread: Boolean(threadRoot),
      canPinMessages,
      canModerate,
      actions,
      desktopOpen,
    }),
    [actions, canModerate, canPinMessages, currentUserId, desktopOpen, nameContext, roomId, showSenderName, threadRoot, workspaceId, youLabel],
  );

  const getVirtualRowKey = useCallback(
    (index: number) => virtualChatRowMeasureKey(messages[index], layout[index], index),
    [layout, messages],
  );

  const getVirtualRowEstimate = useCallback(
    (index: number) => virtualChatRowEstimatePx(layout[index]),
    [layout],
  );

  const renderMessage = useCallback(
    (index: number) => {
      const message = messages[index];
      const rowLayout = layout[index];
      if (!message || !rowLayout) return null;
      return (
        <NativeChatMessageItem
          key={getVirtualRowKey(index)}
          message={message}
          layout={rowLayout}
          context={rowContext}
          highlighted={message.id === highlightMessageId || message.id === openThreadRootId}
          isTimelineTail={index === messages.length - 1}
          selectionActive={selectionActive}
          selected={selectedIds?.has(message.id) ?? false}
          onToggleSelect={onToggleSelect}
        />
      );
    },
    [
      getVirtualRowKey,
      highlightMessageId,
      layout,
      messages,
      onToggleSelect,
      openThreadRootId,
      rowContext,
      selectedIds,
      selectionActive,
    ],
  );

  const senderLabelOf = useCallback(
    (message: ChatMessage) => layout[messages.indexOf(message)]?.senderLabel ?? message.sender,
    [layout, messages],
  );

  return { getVirtualRowKey, getVirtualRowEstimate, renderMessage, senderLabelOf };
}
