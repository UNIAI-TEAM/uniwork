"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { usePendingChatMessagesStore } from "@uniwork/core/chat/pending-messages-store";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import { useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import { stopChatVoicePlayback } from "@uniwork/core/chat/voice-playback-store";
import { listChatRoomMessages, listChatRoomMessagesAround } from "@uniwork/core/api/endpoints/chat";
import {
  useChatRoomMessageLinks,
  useChatRoomMessages,
  useChatThreadMessages,
  useClearDeliveredChatSends,
} from "@uniwork/core/chat";
import { ChatMessagesSkeleton } from "./chat-conversation-skeleton";
import {
  ChatAnchorBar,
  ChatJumpToLatestButton,
  ChatLoadOlderButton,
  ChatOlderMessagesSkeleton,
  ChatThreadBar,
} from "./native-chat-panel-bars";
import type { ChatMessageLinkRecord } from "@uniwork/core/api/endpoints/chat-links";
import type { ChatMessage } from "./chat-messages";
import { CHAT_MESSAGE_INITIAL, CHAT_MESSAGE_MAX_IN_MEMORY, CHAT_MESSAGE_PAGE_SIZE } from "./chat-messages";
import { ChatMessageLinksProvider } from "./chat-message-links-context";
import { ChatReplyComposerBar } from "./chat-reply-quote";
import { toastChatError } from "./chat-error-message";
import { VirtualChatMessageList, updateStickToBottomFromScroll } from "./virtual-chat-message-list";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { toChatMessage } from "./native-chat-message-mapping";
import { NativeChatLiveRegion } from "./native-chat-live-region";
import {
  NativeChatMessageItem,
  layoutNativeChatMessages,
  type NativeChatMessageContext,
} from "./native-chat-message-item";
import { buildMainTimelineMessages, buildThreadViewMessages } from "./native-chat-message-timeline";
import { useMessageTaskLinkDialogs } from "./use-message-task-link-dialogs";
import { focusChatMessage, useNativeChatMessageActions } from "./use-native-chat-message-actions";

const EMPTY_LINKS: ReadonlyMap<string, ChatMessageLinkRecord[]> = new Map();

export function NativeChatMessagePanel({
  workspaceId,
  roomId,
  currentUserId,
  nameContext,
  emptyLabel,
  youLabel,
  replyTo,
  onReplyToChange,
  showSenderName = false,
  embedded = false,
  anchorMessageId = null,
  onClearAnchor,
  canPinMessages = true,
  canSendMessages = false,
  workHubEnabled = false,
  /** Thread API is channel/group/workspace only — never DM (work-hub decision 8). */
  threadsEnabled = false,
  peerLastReadAt = null,
  onFollowUp,
  onActiveThreadRootIdChange,
  onFocusComposer,
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
  /** May write in this room (send, unlink a task): mirrors the server's send gate. */
  canSendMessages?: boolean;
  workHubEnabled?: boolean;
  threadsEnabled?: boolean;
  peerLastReadAt?: string | null;
  onFollowUp?: (message: ChatMessage) => void;
  onActiveThreadRootIdChange?: (threadRootId: string | null) => void;
  /** Puts the caret back in the composer (after reply, thread, cancel, delete). */
  onFocusComposer?: () => void;
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
  const [anchorMessages, setAnchorMessages] = useState<ChatMessage[] | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [loadingAnchor, setLoadingAnchor] = useState(false);
  // A quoted message outside the loaded window opens its context here, the
  // same way a search jump does from the page.
  const [localAnchorId, setLocalAnchorId] = useState<string | null>(null);
  const activeAnchorId = anchorMessageId ?? localAnchorId;
  const { data: latestRows = [], isPending: latestPending } = useChatRoomMessages(
    workspaceId,
    roomId,
    CHAT_MESSAGE_INITIAL,
  );
  // Mirrors stickToBottomRef for rendering: the "back to latest" button shows
  // only once the reader has scrolled away from the newest message.
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const threadQuery = useChatThreadMessages(workspaceId, roomId, threadRoot?.id ?? "", threadsEnabled && !!threadRoot);
  useClearDeliveredChatSends(latestRows);
  useClearDeliveredChatSends(threadQuery.data ?? []);
  const pendingEntries = usePendingChatMessagesStore(useShallow((state) => state.listForRoom(workspaceId, roomId)));
  const outboxEntries = useChatSendOutboxStore(
    useShallow((state) =>
      state.listForWorkspace(workspaceId, currentUserId).filter((entry) => entry.roomId === roomId),
    ),
  );
  const { actions: taskLinkActions, dialogs: taskLinkDialogs } = useMessageTaskLinkDialogs(workspaceId, workHubEnabled);

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
    [anchorMessages, currentUserId, latestRows, olderMessages, outboxEntries, pendingEntries, threadsEnabled],
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
  }, [allMessages, currentUserId, pendingEntries, threadQuery.data, threadRoot, threadsEnabled]);

  const openThread = useCallback(
    (message: ChatMessage) => {
      setThreadRoot(message);
      onReplyToChange(message);
      onActiveThreadRootIdChange?.(message.id);
    },
    [onActiveThreadRootIdChange, onReplyToChange],
  );
  const closeThread = useCallback(() => {
    setThreadRoot(null);
    onReplyToChange(null);
    onActiveThreadRootIdChange?.(null);
  }, [onActiveThreadRootIdChange, onReplyToChange]);

  // A quoted reply scrolls to its original: through the virtual list when it
  // is loaded (rendered or not), and by opening its context otherwise.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const handleJumpToMessage = useCallback((messageId: string) => {
    stickToBottomRef.current = false;
    if (messagesRef.current.some((message) => message.id === messageId)) {
      setHighlightMessageId(null);
      window.requestAnimationFrame(() => setHighlightMessageId(messageId));
      return;
    }
    setLocalAnchorId(messageId);
  }, []);

  const { actions, dialogs: actionDialogs } = useNativeChatMessageActions({
    workspaceId,
    roomId,
    nameContext,
    messages,
    replyTo,
    onReplyToChange,
    threadsEnabled,
    threadRootId: threadRoot?.id ?? null,
    onOpenThread: openThread,
    onCloseThread: closeThread,
    onJumpToMessage: handleJumpToMessage,
    onFocusComposer,
    taskLinkActions,
    onFollowUp,
  });

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
  }, [currentUserId, lastTimelineMessage]);

  useEffect(() => {
    stickToBottomRef.current = true;
    onReplyToChange(null);
    setOlderMessages([]);
    setThreadRoot(null);
    setAnchorMessages(null);
    setHighlightMessageId(null);
    setLocalAnchorId(null);
    onActiveThreadRootIdChange?.(null);
    // One voice player per room: leaving the room stops it.
    return () => stopChatVoicePlayback();
  }, [roomId, onReplyToChange, onActiveThreadRootIdChange]);

  // Only seed hasMore from the initial page when we are not holding older pages.
  useEffect(() => {
    if (olderMessages.length > 0) return;
    setHasMore(latestRows.length >= CHAT_MESSAGE_INITIAL);
  }, [roomId, latestRows.length, olderMessages.length]);

  useEffect(() => {
    if (!activeAnchorId) {
      setAnchorMessages(null);
      setHighlightMessageId(null);
      return;
    }
    let cancelled = false;
    setLoadingAnchor(true);
    void listChatRoomMessagesAround(workspaceId, roomId, activeAnchorId)
      .then((rows) => {
        if (cancelled) return;
        setAnchorMessages(rows.map(toChatMessage));
        setHighlightMessageId(activeAnchorId);
        setOlderMessages([]);
        setHasMore(true);
        stickToBottomRef.current = false;
      })
      .catch((err: unknown) => {
        // The message is gone or unreachable: say so instead of doing nothing.
        if (cancelled) return;
        setLocalAnchorId(null);
        toastChatError(err, t, t("chat.message_list.jump_failed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingAnchor(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAnchorId, roomId, t, workspaceId]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = window.setTimeout(() => setHighlightMessageId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightMessageId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || allMessages.length === 0 || threadRoot || anchorMessages) return;
    stickToBottomRef.current = false;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const oldest = allMessages[0];
      if (!oldest) return;
      const rows = await listChatRoomMessages(workspaceId, roomId, {
        before: new Date(oldest.ts).toISOString(),
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
    } catch (err) {
      // Scrolling up again (or the button) retries; nothing was lost.
      toastChatError(err, t, t("chat.message_list.load_older_failed"));
    } finally {
      setLoadingOlder(false);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight - prevHeight;
      });
    }
  }, [allMessages, anchorMessages, loadingOlder, roomId, t, threadRoot, workspaceId]);

  const onScroll = () => {
    if (programmaticScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = updateStickToBottomFromScroll(el, stickToBottomRef);
    setAwayFromLatest(!nearBottom);
    // Near-top while stick-to-bottom is usually a layout flash after a reload
    // before pin runs — never page older history in that state.
    if (el.scrollTop <= 72 && hasMore && !loadingOlder && !stickToBottomRef.current) {
      void loadOlder();
    }
  };

  // Links for every loaded message in one request, not one per task card.
  const linkMessageIds = useMemo(
    () =>
      workHubEnabled
        ? messages.filter((m) => !m.deliveryStatus && !isPendingChatMessageId(m.id)).map((m) => m.id)
        : [],
    [messages, workHubEnabled],
  );
  const { data: linksByMessageId } = useChatRoomMessageLinks(workspaceId, roomId, linkMessageIds, workHubEnabled);
  const linksValue = useMemo(
    () => ({ linksByMessageId: linksByMessageId ?? EMPTY_LINKS, canUnlink: canSendMessages }),
    [canSendMessages, linksByMessageId],
  );

  const layout = useMemo(
    () => layoutNativeChatMessages(messages, { currentUserId, youLabel, nameContext, peerLastReadAt }),
    [currentUserId, messages, nameContext, peerLastReadAt, youLabel],
  );
  const rowContext = useMemo<NativeChatMessageContext>(
    () => ({
      workspaceId,
      roomId,
      currentUserId,
      youLabel,
      nameContext,
      showSenderName,
      canPinMessages,
      workHubEnabled,
      actions,
    }),
    [actions, canPinMessages, currentUserId, nameContext, roomId, showSenderName, workHubEnabled, workspaceId, youLabel],
  );

  const renderMessage = useCallback(
    (index: number) => {
      const message = messages[index];
      const rowLayout = layout[index];
      if (!message || !rowLayout) return null;
      return (
        <NativeChatMessageItem
          key={message.id}
          message={message}
          layout={rowLayout}
          context={rowContext}
          highlighted={message.id === highlightMessageId}
        />
      );
    },
    [highlightMessageId, layout, messages, rowContext],
  );

  const senderLabelOf = useCallback(
    (message: ChatMessage) => layout[messages.indexOf(message)]?.senderLabel ?? message.sender,
    [layout, messages],
  );

  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setAwayFromLatest(false);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const clearAnchor = () => {
    setLocalAnchorId(null);
    if (anchorMessageId) onClearAnchor?.();
  };

  // Older history loads in the message's own shape. When more exists, a
  // button offers it too — scrolling up is not the only way to ask.
  const canLoadOlder = hasMore && !threadRoot && !anchorMessages;
  const listHeader =
    loadingOlder || loadingAnchor ? (
      <ChatOlderMessagesSkeleton
        label={loadingAnchor ? t("chat.search_loading_context") : t("chat.loading_older")}
      />
    ) : canLoadOlder ? (
      <ChatLoadOlderButton onClick={() => void loadOlder()} />
    ) : !hasMore && !threadRoot && !anchorMessages && intro ? (
      intro
    ) : null;

  return (
    <div
      className={
        embedded
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
      }
    >
      {threadRoot ? (
        <ChatThreadBar
          onClose={() => {
            closeThread();
            onFocusComposer?.();
          }}
        />
      ) : null}
      {activeAnchorId && (onClearAnchor || localAnchorId) ? <ChatAnchorBar onBackToLatest={clearAnchor} /> : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* A log, but a silent one: the virtual list mounts rows as it
            scrolls, and a live log would read each of them out. What is new
            is said once, by NativeChatLiveRegion. */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pt-2 pb-4 sm:px-4"
          role="log"
          aria-live="off"
          aria-label={t("chat.messages_region")}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard to scroll it (axe scrollable-region-focusable)
          tabIndex={0}
        >
          <ChatMessageLinksProvider value={linksValue}>
            <VirtualChatMessageList
              key={roomId}
              messages={messages}
              scrollRef={scrollRef}
              stickToBottomRef={stickToBottomRef}
              programmaticScrollRef={programmaticScrollRef}
              highlightMessageId={highlightMessageId}
              onHighlightShown={focusChatMessage}
              header={listHeader}
              empty={
                latestPending ? (
                  <ChatMessagesSkeleton className="px-0" />
                ) : (
                  (intro ?? <p className="py-6 text-center text-body text-pretty text-muted-foreground">{emptyLabel}</p>)
                )
              }
              renderMessage={renderMessage}
            />
          </ChatMessageLinksProvider>
        </div>
        <NativeChatLiveRegion
          roomId={roomId}
          messages={messages}
          currentUserId={currentUserId}
          senderLabelOf={senderLabelOf}
        />
        {awayFromLatest && !threadRoot && !activeAnchorId ? <ChatJumpToLatestButton onClick={scrollToLatest} /> : null}
      </div>
      {replyTo ? (
        <ChatReplyComposerBar
          message={replyTo}
          workspaceId={workspaceId}
          roomId={roomId}
          onCancel={() => {
            onReplyToChange(null);
            onFocusComposer?.();
          }}
        />
      ) : null}
      {actionDialogs}
      {taskLinkDialogs}
    </div>
  );
}
