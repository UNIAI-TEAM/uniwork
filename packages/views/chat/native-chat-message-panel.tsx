"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatMessagesSkeleton } from "./chat-conversation-skeleton";
import {
  ChatAnchorBar,
  ChatJumpToLatestButton,
  ChatOlderMessagesSkeleton,
  ChatThreadBar,
} from "./native-chat-panel-bars";
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
import { parseChatMediaMessageBody } from "./chat-expression-utils";
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
  /** Thread API is channel/group/workspace only — never DM (work-hub decision 8). */
  threadsEnabled = false,
  peerLastReadAt = null,
  onFollowUp,
  onActiveThreadRootIdChange,
  intro,
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
  threadsEnabled?: boolean;
  peerLastReadAt?: string | null;
  onFollowUp?: (message: ChatMessage) => void;
  onActiveThreadRootIdChange?: (threadRootId: string | null) => void;
  /** Where the room begins: shown when empty, and above the first message once all history is loaded. */
  intro?: ReactNode;
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
  const { data: latestRows = [], isPending: latestPending } = useChatRoomMessages(
    workspaceId,
    roomId,
    CHAT_MESSAGE_INITIAL,
  );
  // Mirrors stickToBottomRef for rendering: the "back to latest" button shows
  // only once the reader has scrolled away from the newest message.
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const threadQuery = useChatThreadMessages(
    workspaceId,
    roomId,
    threadRoot?.id ?? "",
    threadsEnabled && !!threadRoot,
  );
  const markThreadRead = useMarkChatThreadRead(workspaceId);
  useClearDeliveredChatSends(latestRows);
  useClearDeliveredChatSends(threadQuery.data ?? []);
  const pendingEntries = usePendingChatMessagesStore(
    useShallow((state) => state.listForRoom(workspaceId, roomId)),
  );
  const outboxEntries = useChatSendOutboxStore(
    useShallow((state) =>
      state.listForWorkspace(workspaceId, currentUserId).filter((entry) => entry.roomId === roomId),
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

  const handleToggleReaction = useCallback(
    (message: ChatMessage, emoji: string) => {
      void toggleReaction.mutateAsync({ roomId, messageId: message.id, emoji });
    },
    [roomId, toggleReaction],
  );

  // A quoted reply scrolls to its original when that message is on screen or
  // in the loaded window, and flashes it the same way a search jump does.
  const handleJumpToMessage = useCallback((messageId: string) => {
    const node = document.getElementById(`chat-msg-${messageId}`);
    if (!node) return;
    stickToBottomRef.current = false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    setHighlightMessageId(messageId);
  }, []);

  const handleThread = useCallback(
    (message: ChatMessage) => {
      if (!threadsEnabled) return;
      setThreadRoot(message);
      onReplyToChange(message);
      onActiveThreadRootIdChange?.(message.id);
      void markThreadRead.mutateAsync(message.id).catch(() => undefined);
    },
    [markThreadRead, onActiveThreadRootIdChange, onReplyToChange, threadsEnabled],
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
      // A sticker or GIF copies as its link, not as its markdown.
      await navigator.clipboard.writeText(parseChatMediaMessageBody(message.body)?.url ?? message.body);
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
        workHubEnabled: threadsEnabled,
      }),
    [
      anchorMessages,
      currentUserId,
      latestRows,
      olderMessages,
      outboxEntries,
      pendingEntries,
      threadsEnabled,
    ],
  );

  const messages = useMemo(() => {
    if (!threadRoot || !threadsEnabled) return allMessages;
    return buildThreadViewMessages({
      allMessages,
      threadRoot,
      threadRows: threadQuery.data,
      pendingEntries,
      currentUserId,
      workHubEnabled: threadsEnabled,
    });
  }, [
    allMessages,
    currentUserId,
    pendingEntries,
    threadQuery.data,
    threadRoot,
    threadsEnabled,
  ]);

  useEffect(() => {
    if (!threadsEnabled && threadRoot) {
      setThreadRoot(null);
      onActiveThreadRootIdChange?.(null);
    }
  }, [threadsEnabled, threadRoot, onActiveThreadRootIdChange]);

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
    const nearBottom = updateStickToBottomFromScroll(el, stickToBottomRef);
    setAwayFromLatest(!nearBottom);
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
          onToggleReaction: handleToggleReaction,
          onJumpToMessage: handleJumpToMessage,
          onThread: threadsEnabled ? handleThread : undefined,
          onEdit: handleEdit,
          onPin: handlePin,
          onCopy: handleCopy,
          onDelete: handleDelete,
          onCreateTask: taskLinkActions?.onCreateTask,
          onLinkTask: taskLinkActions?.onLinkTask,
          onFollowUp,
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
      handleToggleReaction,
      handleJumpToMessage,
      highlightMessageId,
      messages,
      messagesById,
      nameContext,
      onFollowUp,
      onReplyToChange,
      peerLastReadAt,
      roomId,
      showSenderName,
      taskLinkActions,
      threadsEnabled,
      workHubEnabled,
      workspaceId,
      youLabel,
    ],
  );

  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setAwayFromLatest(false);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  // Older history loads in the message's own shape; when more exists and
  // nothing is loading, the header stays empty — scrolling up is the cue.
  const listHeader =
    loadingOlder || loadingAnchor ? (
      <ChatOlderMessagesSkeleton
        label={loadingAnchor ? t("chat.search_loading_context") : t("chat.loading_older")}
      />
    ) : !hasMore && !threadRoot && !anchorMessages && intro ? (
      intro
    ) : null;

  return (
    <div className={embedded ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"}>
      {threadRoot ? (
        <ChatThreadBar
          onClose={() => {
            setThreadRoot(null);
            onReplyToChange(null);
            onActiveThreadRootIdChange?.(null);
          }}
        />
      ) : null}
      {anchorMessageId && onClearAnchor ? <ChatAnchorBar onBackToLatest={onClearAnchor} /> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pt-2 pb-4 sm:px-4"
          role="log"
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
            empty={
              latestPending ? (
                <ChatMessagesSkeleton className="px-0" />
              ) : (
                (intro ?? (
                  <p className="py-6 text-center text-body text-pretty text-muted-foreground">{emptyLabel}</p>
                ))
              )
            }
            renderMessage={renderMessage}
          />
        </div>
        {awayFromLatest && !threadRoot && !anchorMessageId ? (
          <ChatJumpToLatestButton onClick={scrollToLatest} />
        ) : null}
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
