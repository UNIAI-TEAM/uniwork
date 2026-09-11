"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { usePendingChatMessagesStore } from "@uniwork/core/chat/pending-messages-store";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import { useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import { listChatRoomMessages, listChatRoomMessagesAround } from "@uniwork/core/api/endpoints/chat";
import {
  useChatRoomMessages,
  useChatThreadMessages,
  useClearDeliveredChatSends,
  useDeleteChatMessage,
  useEditChatMessage,
  useMarkChatThreadRead,
  useToggleChatMessagePin,
  useToggleChatReaction,
} from "@uniwork/core/chat";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import { serializeComposerDraftToMessageBody } from "./chat-mention-utils";
import { ChatMessageEditDialog } from "./chat-message-edit-dialog";
import type { ChatMessage } from "./chat-messages";
import { CHAT_MESSAGE_INITIAL, CHAT_MESSAGE_MAX_IN_MEMORY, CHAT_MESSAGE_PAGE_SIZE } from "./chat-messages";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import { ChatReplyComposerBar } from "./chat-reply-quote";
import { VirtualChatMessageList, updateStickToBottomFromScroll } from "./virtual-chat-message-list";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { toChatMessage } from "./native-chat-message-mapping";
import { renderNativeChatMessage } from "./native-chat-message-item";
import {
  buildMainTimelineMessages,
  buildThreadViewMessages,
} from "./native-chat-message-timeline";
import { useMessageTaskLinkDialogs } from "./use-message-task-link-dialogs";

export function NativeChatMessagePanel({
  workspaceId,
  roomId,
  currentUserId,
  nameContext,
  emptyLabel,
  youLabel,
  replyTo,
  onReplyToChange,
  refreshKey: _refreshKey,
  showSenderName = false,
  embedded = false,
  anchorMessageId = null,
  onClearAnchor,
  canPinMessages = true,
  workHubEnabled = false,
  peerLastReadAt = null,
  onActiveThreadRootIdChange,
}: {
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  nameContext: NameContextEntry[];
  emptyLabel: string;
  youLabel: string;
  replyTo: ChatMessage | null;
  onReplyToChange: (message: ChatMessage | null) => void;
  refreshKey?: number;
  showSenderName?: boolean;
  embedded?: boolean;
  anchorMessageId?: string | null;
  onClearAnchor?: () => void;
  canPinMessages?: boolean;
  workHubEnabled?: boolean;
  peerLastReadAt?: string | null;
  onActiveThreadRootIdChange?: (threadRootId: string | null) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [threadRoot, setThreadRoot] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [anchorMessages, setAnchorMessages] = useState<ChatMessage[] | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [loadingAnchor, setLoadingAnchor] = useState(false);
  const { data: latestRows = [] } = useChatRoomMessages(workspaceId, roomId, CHAT_MESSAGE_INITIAL);
  const threadQuery = useChatThreadMessages(
    workspaceId,
    roomId,
    threadRoot?.id ?? "",
    workHubEnabled && !!threadRoot,
  );
  const markThreadRead = useMarkChatThreadRead(workspaceId);
  useClearDeliveredChatSends(latestRows);
  useClearDeliveredChatSends(threadQuery.data ?? []);
  const pendingEntries = usePendingChatMessagesStore(
    useShallow((state) => state.listForRoom(workspaceId, roomId)),
  );
  const outboxEntries = useChatSendOutboxStore(
    useShallow((state) =>
      state.listForWorkspace(workspaceId).filter((entry) => entry.roomId === roomId),
    ),
  );
  const toggleReaction = useToggleChatReaction(workspaceId);
  const editMessage = useEditChatMessage(workspaceId);
  const deleteMessage = useDeleteChatMessage(workspaceId);
  const togglePin = useToggleChatMessagePin(workspaceId);
  const { actions: taskLinkActions, dialogs: taskLinkDialogs } = useMessageTaskLinkDialogs(
    workspaceId,
    workHubEnabled,
  );

  const handleReact = useCallback(
    (message: ChatMessage) => {
      void toggleReaction.mutateAsync({
        roomId,
        messageId: message.id,
        emoji: DEFAULT_QUICK_REACTION,
      });
    },
    [roomId, toggleReaction],
  );

  const handleThread = useCallback(
    (message: ChatMessage) => {
      setThreadRoot(message);
      onReplyToChange(message);
      onActiveThreadRootIdChange?.(message.id);
      if (workHubEnabled) {
        void markThreadRead.mutateAsync(message.id).catch(() => undefined);
      }
    },
    [markThreadRead, onActiveThreadRootIdChange, onReplyToChange, workHubEnabled],
  );

  const handleEdit = useCallback((message: ChatMessage) => {
    setEditingMessage(message);
  }, []);

  const handleSaveEdit = useCallback(
    async (body: string) => {
      if (!editingMessage) return;
      const mentionCandidates: ChatMentionCandidate[] = nameContext.map((entry) => ({
        kind: "member" as const,
        userId: entry.user_id,
        label: entry.display_name,
      }));
      const text = serializeComposerDraftToMessageBody(body, mentionCandidates, t("chat.mention_all"));
      await editMessage.mutateAsync({
        roomId,
        messageId: editingMessage.id,
        body: text,
      });
      setEditingMessage(null);
    },
    [editMessage, editingMessage, nameContext, roomId, t],
  );

  const handlePin = useCallback(
    (message: ChatMessage) => {
      void togglePin.mutateAsync({ roomId, messageId: message.id });
    },
    [roomId, togglePin],
  );

  const handleCopy = useCallback(async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.body);
    } catch {
      // Clipboard may be unavailable in tests or insecure contexts.
    }
  }, []);

  const handleDelete = useCallback(
    async (message: ChatMessage) => {
      await deleteMessage.mutateAsync({ roomId, messageId: message.id });
      if (replyTo?.id === message.id) onReplyToChange(null);
      if (threadRoot?.id === message.id) setThreadRoot(null);
    },
    [deleteMessage, onReplyToChange, replyTo?.id, roomId, threadRoot?.id],
  );

  const allMessages = useMemo(
    () =>
      buildMainTimelineMessages({
        anchorMessages,
        latestRows,
        olderMessages,
        pendingEntries,
        outboxEntries,
        currentUserId,
        workHubEnabled,
      }),
    [
      anchorMessages,
      currentUserId,
      latestRows,
      olderMessages,
      outboxEntries,
      pendingEntries,
      workHubEnabled,
    ],
  );

  const messages = useMemo(() => {
    if (!threadRoot) return allMessages;
    return buildThreadViewMessages({
      allMessages,
      threadRoot,
      threadRows: threadQuery.data,
      pendingEntries,
      currentUserId,
      workHubEnabled,
    });
  }, [allMessages, currentUserId, pendingEntries, threadQuery.data, threadRoot, workHubEnabled]);

  useEffect(() => {
    onActiveThreadRootIdChange?.(threadRoot?.id ?? null);
  }, [onActiveThreadRootIdChange, threadRoot?.id]);

  // Own optimistic / pending sends must keep the viewport on the newest row.
  const lastTimelineMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!lastTimelineMessage) return;
    if (
      lastTimelineMessage.deliveryStatus === "sending" ||
      lastTimelineMessage.deliveryStatus === "queued" ||
      isPendingChatMessageId(lastTimelineMessage.id) ||
      lastTimelineMessage.sender === currentUserId
    ) {
      stickToBottomRef.current = true;
    }
  }, [
    currentUserId,
    lastTimelineMessage,
  ]);

  useEffect(() => {
    stickToBottomRef.current = true;
    onReplyToChange(null);
    setOlderMessages([]);
    setThreadRoot(null);
    setAnchorMessages(null);
    setHighlightMessageId(null);
    onActiveThreadRootIdChange?.(null);
  }, [roomId, onReplyToChange, onActiveThreadRootIdChange]);

  // Only seed hasMore from the initial page when we are not holding older pages.
  useEffect(() => {
    if (olderMessages.length > 0) return;
    setHasMore(latestRows.length >= CHAT_MESSAGE_INITIAL);
  }, [roomId, latestRows.length, olderMessages.length]);

  useEffect(() => {
    if (!anchorMessageId) {
      setAnchorMessages(null);
      setHighlightMessageId(null);
      return;
    }
    let cancelled = false;
    setLoadingAnchor(true);
    void listChatRoomMessagesAround(workspaceId, roomId, anchorMessageId)
      .then((rows) => {
        if (cancelled) return;
        setAnchorMessages(rows.map(toChatMessage));
        setHighlightMessageId(anchorMessageId);
        setOlderMessages([]);
        setHasMore(true);
        stickToBottomRef.current = false;
      })
      .finally(() => {
        if (!cancelled) setLoadingAnchor(false);
      });
    return () => {
      cancelled = true;
    };
  }, [anchorMessageId, roomId, workspaceId]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = window.setTimeout(() => setHighlightMessageId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightMessageId, anchorMessages]);

  // refreshKey used to wipe older pages on every send; that jumped the viewport
  // and re-triggered "load older". Keep history while sticking to new messages.

  const loadOlder = useCallback(async () => {
    if (loadingOlder || allMessages.length === 0 || threadRoot || anchorMessages) return;
    stickToBottomRef.current = false;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const oldest = allMessages[0];
      if (!oldest) return;
      const before = new Date(oldest.ts).toISOString();
      const rows = await listChatRoomMessages(workspaceId, roomId, {
        before,
        limit: CHAT_MESSAGE_PAGE_SIZE,
      });
      const older = rows.map(toChatMessage);
      setHasMore(rows.length >= CHAT_MESSAGE_PAGE_SIZE);
      setOlderMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...older.filter((m) => !seen.has(m.id)), ...prev].sort((a, b) => a.ts - b.ts);
        if (merged.length <= CHAT_MESSAGE_MAX_IN_MEMORY) return merged;
        return merged.slice(merged.length - CHAT_MESSAGE_MAX_IN_MEMORY);
      });
    } finally {
      setLoadingOlder(false);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight - prevHeight;
      });
    }
  }, [allMessages, anchorMessages, loadingOlder, roomId, threadRoot, workspaceId]);

  const onScroll = () => {
    if (programmaticScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    updateStickToBottomFromScroll(el, stickToBottomRef);
    // Near-top while stick-to-bottom is usually a layout flash after a reload
    // before pin runs — never page older history in that state.
    if (
      el.scrollTop <= 72 &&
      hasMore &&
      !loadingOlder &&
      !stickToBottomRef.current
    ) {
      void loadOlder();
    }
  };

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const renderMessage = useCallback(
    (index: number) =>
      renderNativeChatMessage({
        messages,
        index,
        messagesById,
        workspaceId,
        roomId,
        currentUserId,
        youLabel,
        nameContext,
        showSenderName,
        canPinMessages,
        highlightMessageId,
        workHubEnabled,
        peerLastReadAt,
        actions: {
          onReply: onReplyToChange,
          onReact: handleReact,
          onThread: handleThread,
          onEdit: handleEdit,
          onPin: handlePin,
          onCopy: handleCopy,
          onDelete: handleDelete,
          onCreateTask: taskLinkActions?.onCreateTask,
          onLinkTask: taskLinkActions?.onLinkTask,
        },
      }),
    [
      canPinMessages,
      currentUserId,
      handleCopy,
      handleDelete,
      handleEdit,
      handlePin,
      handleReact,
      handleThread,
      highlightMessageId,
      messages,
      messagesById,
      nameContext,
      onReplyToChange,
      peerLastReadAt,
      roomId,
      showSenderName,
      taskLinkActions,
      workHubEnabled,
      workspaceId,
      youLabel,
    ],
  );

  const listHeader = (
    <>
      {loadingOlder || loadingAnchor ? (
        <p className="mb-3 text-center text-caption text-muted-foreground">
          {loadingAnchor ? t("chat.search_loading_context") : t("chat.loading_older")}
        </p>
      ) : null}
      {!loadingOlder && hasMore ? (
        <p className="mb-3 text-center text-caption text-muted-foreground">{t("chat.scroll_for_older")}</p>
      ) : null}
    </>
  );

  return (
    <div className={embedded ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"}>
      {threadRoot ? (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
          <p className="min-w-0 truncate text-caption font-medium text-foreground">
            {t("chat.thread_title")}
          </p>
          <button
            type="button"
            className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setThreadRoot(null);
              onReplyToChange(null);
              onActiveThreadRootIdChange?.(null);
            }}
          >
            {t("chat.close_thread")}
          </button>
        </div>
      ) : null}
      {anchorMessageId && onClearAnchor ? (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
          <p className="min-w-0 truncate text-caption text-muted-foreground">
            {t("chat.search_jump_banner")}
          </p>
          <button
            type="button"
            className="shrink-0 text-caption font-medium text-foreground underline-offset-2 hover:underline"
            onClick={onClearAnchor}
          >
            {t("chat.search_back_to_latest")}
          </button>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted/25 px-4 py-4"
        aria-label={t("chat.messages_region")}
      >
        <VirtualChatMessageList
          key={roomId}
          messages={messages}
          scrollRef={scrollRef}
          stickToBottomRef={stickToBottomRef}
          programmaticScrollRef={programmaticScrollRef}
          highlightMessageId={highlightMessageId}
          header={listHeader}
          empty={<p className="text-body text-muted-foreground">{emptyLabel}</p>}
          renderMessage={renderMessage}
        />
      </div>
      {replyTo ? (
        <ChatReplyComposerBar
          message={replyTo}
          workspaceId={workspaceId}
          roomId={roomId}
          onCancel={() => onReplyToChange(null)}
        />
      ) : null}
      <ChatMessageEditDialog
        open={editingMessage != null}
        initialBody={editingMessage?.body ?? ""}
        saving={editMessage.isPending}
        onOpenChange={(open) => {
          if (!open) setEditingMessage(null);
        }}
        onSave={(body) => {
          void handleSaveEdit(body);
        }}
      />
      {taskLinkDialogs}
    </div>
  );
}
