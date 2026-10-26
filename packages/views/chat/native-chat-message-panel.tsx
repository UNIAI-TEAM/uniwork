"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { usePendingChatMessagesStore } from "@uniwork/core/chat/pending-messages-store";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import { useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import { selectSidebarTypingUserIds, useSidebarTypingStore } from "@uniwork/core/chat/sidebar-typing-store";
import { stopChatVoicePlayback } from "@uniwork/core/chat/voice-playback-store";
import {
  useChatRoomMessageLinks,
  useChatRoomMessages,
  useChatThreadMessages,
  useClearDeliveredChatSends,
  useMarkChatRoomReadAtLatest,
} from "@uniwork/core/chat";
import { ChatMessagesSkeleton } from "./chat-conversation-skeleton";
import {
  ChatAnchorBar,
  ChatJumpToLatestButton,
  ChatLoadOlderButton,
  ChatLoadOlderHeaderSpacer,
  ChatOlderMessagesSkeleton,
  ChatThreadBar,
} from "./native-chat-panel-bars";
import type { ChatMessageLinkRecord } from "@uniwork/core/api/endpoints/chat-links";
import type { ChatMessage } from "./chat-messages";
import { CHAT_MESSAGE_INITIAL } from "./chat-messages";
import { ChatMessageLinksProvider } from "./chat-message-links-context";
import { ChatLinkPreviewsProvider } from "./chat-link-preview-card";
import { ChatForwardContext } from "./chat-forward-context";
import { ChatPeerReadAtContext } from "./chat-message-parts";
import { CHAT_CONVERSATION_GUTTER } from "./chat-wall";
import { cn } from "@uniwork/ui/lib/utils";
import { useChatWall } from "./use-chat-wall";
import { toastChatError } from "./chat-error-message";
import { useChatOlderPrefetch } from "./use-chat-older-prefetch";
import { applyChatScrollAwayHysteresis } from "./use-chat-timeline-scroll";
import { VirtualChatMessageList, useReaderScrollAt } from "./virtual-chat-message-list";
import { toChatMessage, type NameContextEntry } from "./native-chat-message-mapping";
import { NativeChatLiveRegion } from "./native-chat-live-region";
import { ChatTypingBubble } from "./native-chat-typing-bubble";
import { useNativeChatMessageRows } from "./use-native-chat-message-rows";
import { buildMainTimelineMessages, buildThreadViewMessages, countNewSince } from "./native-chat-message-timeline";
import { ChatIntroCompactContext } from "./chat-conversation-intro";
import { useMessageTaskLinkDialogs } from "./use-message-task-link-dialogs";
import { useNativeChatMessageActions } from "./use-native-chat-message-actions";
import { useAnchorWindowLoad, useChatHighlightFlash, useOwnSendFollowsLatest, useTypingKeepsPinned } from "./use-chat-anchor-follow";
import type { ChatDocumentDesktopOpen } from "./chat-document-menu";

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
  canModerate = false,
  canSendMessages = false,
  /** Thread API is channel/group/workspace only — never DM (work-hub decision 8). */
  threadsEnabled = false,
  peerLastReadAt = null,
  unreadSince = null,
  onFollowUp,
  onActiveThreadRootIdChange,
  onFocusComposer,
  onEditMessage,
  onOpenThread,
  thread = null,
  onCloseThread,
  openThreadRootId = null,
  threadSubtitle,
  roomTitle,
  intro,
  desktopOpen,
}: {
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  nameContext: NameContextEntry[];
  emptyLabel: string;
  youLabel: string;
  replyTo: ChatMessage | null;
  onReplyToChange: (message: ChatMessage | null) => void;
  showSenderName?: boolean;
  embedded?: boolean;
  anchorMessageId?: string | null;
  onClearAnchor?: () => void;
  canPinMessages?: boolean;
  /** Room moderator: may delete other members' reminders. */
  canModerate?: boolean;
  /** May write in this room (send, unlink a task): mirrors the server's send gate. */
  canSendMessages?: boolean;
  threadsEnabled?: boolean;
  peerLastReadAt?: string | null;
  /** The reader's read pointer from before the room opened: "Tin mới" goes after it. */
  unreadSince?: string | null;
  onFollowUp?: (message: ChatMessage) => void;
  onActiveThreadRootIdChange?: (threadRootId: string | null) => void;
  /** Puts the caret back in the composer (after reply, thread, cancel, delete). */
  onFocusComposer?: () => void;
  /** "Sửa": puts this panel's composer into edit mode for the message. */
  onEditMessage: (message: ChatMessage) => void;
  /** Threads open beside this panel (lg and up) instead of in it. */
  onOpenThread?: (message: ChatMessage) => void;
  /** This panel is the side thread panel: it shows only this thread, and closing it calls `onCloseThread`. */
  thread?: ChatMessage | null;
  onCloseThread?: () => void;
  /** The thread open beside this timeline: its root stays highlighted. */
  openThreadRootId?: string | null;
  /** Under the thread bar's title (the room's name, in the side panel). */
  threadSubtitle?: string;
  /** The room's name, for the create-task dialog's quote (the side panel's subtitle when unset). */
  roomTitle?: string;
  /** Where the room begins: shown when empty, and above the first message once all history is loaded. */
  intro?: ReactNode;
  /** Host wiring for a document card's "Chỉnh sửa trong UniWork Office" menu entry; absent → hidden. */
  desktopOpen?: ChatDocumentDesktopOpen;
}) {
  const { t } = useTranslation();
  const chatWall = useChatWall(roomId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const readerScrollAtRef = useReaderScrollAt(scrollRef);
  const stickToBottomRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const olderPrefetchSentinelRef = useRef<HTMLDivElement | null>(null);
  const olderLoadLockRef = useRef(false);
  const [inPlaceThread, setThreadRoot] = useState<ChatMessage | null>(null);
  const threadRoot = thread ?? inPlaceThread;
  const sideThreadPanel = thread != null;
  const [anchorMessages, setAnchorMessages] = useState<ChatMessage[] | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [loadingAnchor, setLoadingAnchor] = useState(false);
  // A quoted message outside the loaded window opens its context here, the
  // same way a search jump does from the page.
  // Scoped to its room, so the render that switches rooms cannot ask the new
  // room for the old room's message before the reset effect runs.
  const [localAnchor, setLocalAnchor] = useState<{ roomId: string; id: string } | null>(null);
  const localAnchorId = localAnchor?.roomId === roomId ? localAnchor.id : null;
  const activeAnchorId = anchorMessageId ?? localAnchorId;
  // Every loaded page of the room, newest page first in the cache, one list here.
  const {
    data: latestRows = [],
    isPending: latestPending,
    isRefetching: latestRefetching = false,
    hasNextPage: roomHasMore,
    isFetchingNextPage: roomLoadingOlder,
    fetchNextPage: fetchOlderRoomPage,
  } = useChatRoomMessages(workspaceId, roomId, CHAT_MESSAGE_INITIAL);
  // Mirrors stickToBottomRef for rendering: the "back to latest" button shows
  // only once the reader has scrolled away from the newest message.
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const awayFromLatestRef = useRef(false);
  // The newest message when the reader scrolled away: the jump button counts what came after it.
  const [awaySinceId, setAwaySinceId] = useState<string | null>(null);
  const threadQuery = useChatThreadMessages(workspaceId, roomId, threadRoot?.id ?? "", threadsEnabled && !!threadRoot);
  // An open thread pages its own older replies (UNI-1679), not the room's.
  const hasMore = threadRoot ? threadQuery.hasNextPage : roomHasMore;
  const loadingOlder = threadRoot ? threadQuery.isFetchingNextPage : roomLoadingOlder;
  const fetchNextPage = threadRoot ? threadQuery.fetchNextPage : fetchOlderRoomPage;
  useClearDeliveredChatSends(latestRows);
  useClearDeliveredChatSends(threadQuery.data ?? []);
  useMarkChatRoomReadAtLatest(
    workspaceId,
    roomId,
    latestRows[latestRows.length - 1]?.id ?? null,
    !awayFromLatest && !threadRoot && !anchorMessages,
  );
  const serverChatMessages = useMemo(() => latestRows.map(toChatMessage), [latestRows]);
  const pendingEntries = usePendingChatMessagesStore(useShallow((state) => state.listForRoom(workspaceId, roomId)));
  const outboxEntries = useChatSendOutboxStore(
    useShallow((state) =>
      state.listForWorkspace(workspaceId, currentUserId).filter((entry) => entry.roomId === roomId),
    ),
  );
  const typingUserIds = useSidebarTypingStore(useShallow((state) => selectSidebarTypingUserIds(state, roomId)));
  const { actions: taskLinkActions, dialogs: taskLinkDialogs } = useMessageTaskLinkDialogs(workspaceId, roomTitle ?? threadSubtitle);

  const latestMessages = useMemo(
    () =>
      buildMainTimelineMessages({
        anchorMessages: null,
        serverMessages: serverChatMessages,
        pendingEntries,
        outboxEntries,
        currentUserId,
        threadsEnabled,
      }),
    [currentUserId, serverChatMessages, outboxEntries, pendingEntries, threadsEnabled],
  );
  const allMessages = anchorMessages ?? latestMessages;

  const messages = useMemo(() => {
    if (!threadRoot || !threadsEnabled) return allMessages;
    return buildThreadViewMessages({
      allMessages,
      threadRoot,
      threadRows: threadQuery.data,
      pendingEntries,
      outboxEntries,
      currentUserId,
      threadsEnabled,
    });
  }, [
    allMessages,
    currentUserId,
    outboxEntries,
    pendingEntries,
    threadQuery.data,
    threadRoot,
    threadsEnabled,
  ]);

  const openThread = useCallback(
    (message: ChatMessage) => {
      if (onOpenThread) {
        onOpenThread(message);
        return;
      }
      setThreadRoot(message);
      onReplyToChange(message);
      onActiveThreadRootIdChange?.(message.id);
    },
    [onActiveThreadRootIdChange, onOpenThread, onReplyToChange],
  );
  const closeThread = useCallback(() => {
    if (thread) {
      onCloseThread?.();
      return;
    }
    setThreadRoot(null);
    onReplyToChange(null);
    onActiveThreadRootIdChange?.(null);
  }, [onActiveThreadRootIdChange, onCloseThread, onReplyToChange, thread]);

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
    setLocalAnchor({ roomId, id: messageId });
  }, [roomId]);

  const { actions, dialogs: actionDialogs } = useNativeChatMessageActions({
    workspaceId,
    roomId,
    currentUserId,
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
    onEditMessage,
    canModerate,
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

  const onClearAnchorRef = useRef(onClearAnchor);
  onClearAnchorRef.current = onClearAnchor;

  // The latest page replaces the anchor window; re-sticking lets the list pin
  // it to the bottom and the room be marked read, as scrollToLatest does.
  const clearAnchor = useCallback(() => {
    stickToBottomRef.current = true;
    programmaticScrollRef.current = false;
    awayFromLatestRef.current = false;
    setAwayFromLatest(false);
    setAnchorMessages(null);
    setHighlightMessageId(null);
    setLocalAnchor(null);
    if (anchorMessageId) onClearAnchorRef.current?.();
  }, [anchorMessageId]);

  useTypingKeepsPinned(typingUserIds.length > 0, scrollRef, stickToBottomRef);

  useOwnSendFollowsLatest({
    timelineMessages: threadRoot && threadsEnabled ? messages : latestMessages, anchored: Boolean(anchorMessages),
    roomId, activeAnchorId, currentUserId, latestRefetching, clearAnchor, stickToBottomRef,
  });

  const lastMessageId = messages[messages.length - 1]?.id;
  useLayoutEffect(() => {
    if (stickToBottomRef.current && !anchorMessages) {
      awayFromLatestRef.current = false;
      setAwayFromLatest(false);
    }
  }, [anchorMessages, messages.length, lastMessageId]);

  useEffect(() => {
    stickToBottomRef.current = true;
    awayFromLatestRef.current = false;
    setAwayFromLatest(false);
    onReplyToChange(null);
    setThreadRoot(null);
    setAnchorMessages(null);
    setHighlightMessageId(null);
    setLocalAnchor(null);
    onActiveThreadRootIdChange?.(null);
    // One voice player per room: leaving the room stops it. Closing the side
    // thread is not leaving the room; the timeline beside it may be playing.
    return () => {
      if (!sideThreadPanel) stopChatVoicePlayback();
    };
  }, [roomId, onReplyToChange, onActiveThreadRootIdChange, sideThreadPanel]);

  useAnchorWindowLoad({
    workspaceId, roomId, activeAnchorId, stickToBottomRef, programmaticScrollRef, onClearAnchorRef,
    setAnchorMessages, setHighlightMessageId, setLoadingAnchor, setAwayFromLatest, setLocalAnchor,
  });

  const handleHighlightShown = useChatHighlightFlash(highlightMessageId, setHighlightMessageId);

  const loadOlder = useCallback(async () => {
    if (olderLoadLockRef.current || loadingOlder || !hasMore || (!threadRoot && anchorMessages)) return;
    olderLoadLockRef.current = true;
    stickToBottomRef.current = false;
    try {
      const result = await fetchNextPage();
      if (result.isFetchNextPageError) toastChatError(result.error, t, t("chat.message_list.load_older_failed"));
    } finally {
      olderLoadLockRef.current = false;
    }
  }, [anchorMessages, fetchNextPage, hasMore, loadingOlder, t, threadRoot]);

  const prefetchOlderEnabled =
    awayFromLatest && hasMore && !loadingOlder && (!!threadRoot || !anchorMessages);
  useChatOlderPrefetch(scrollRef, olderPrefetchSentinelRef, {
    enabled: prefetchOlderEnabled,
    loadingOlder,
    onPrefetch: loadOlder,
  });

  const onScroll = () => {
    if (programmaticScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const transition = applyChatScrollAwayHysteresis(el, stickToBottomRef, awayFromLatestRef);
    if (transition === "entered-away") {
      setAwaySinceId(messages[messages.length - 1]?.id ?? null);
      setAwayFromLatest(true);
    } else if (transition === "returned-bottom") {
      setAwayFromLatest(false);
    }
  };

  // Links for every loaded message in one request, not one per task card.
  const linkMessageIds = useMemo(
    () => messages.filter((m) => !m.deliveryStatus && !isPendingChatMessageId(m.id)).map((m) => m.id),
    [messages],
  );
  const { data: linksByMessageId } = useChatRoomMessageLinks(workspaceId, roomId, linkMessageIds);
  const linksValue = useMemo(
    () => ({ linksByMessageId: linksByMessageId ?? EMPTY_LINKS, canUnlink: canSendMessages }),
    [canSendMessages, linksByMessageId],
  );

  // The read pointers follow the main timeline: no "Đã xem" inside a thread.
  const receiptReadAt = threadRoot ? null : peerLastReadAt;
  const { getVirtualRowKey, getVirtualRowEstimate, renderMessage, senderLabelOf } = useNativeChatMessageRows({
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
  });

  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    awayFromLatestRef.current = false;
    setAwayFromLatest(false);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  };

  // Older history loads in the message's own shape. When more exists, a
  // button offers it too — scrolling up is not the only way to ask.
  const canLoadOlder = hasMore && (!!threadRoot || !anchorMessages);
  const listHeader =
    loadingAnchor ? (
      <ChatOlderMessagesSkeleton label={t("chat.search_loading_context")} />
    ) : canLoadOlder && loadingOlder ? (
      <ChatLoadOlderHeaderSpacer busyLabel={t("chat.loading_older")} />
    ) : canLoadOlder ? (
      <ChatLoadOlderButton onClick={() => void loadOlder()} />
    ) : !hasMore && !threadRoot && !anchorMessages && intro ? (
      // Above messages the intro is a one-line chip; an empty room keeps the card (the `empty` slot).
      <ChatIntroCompactContext.Provider value>{intro}</ChatIntroCompactContext.Provider>
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
          workspaceId={workspaceId}
          threadRootId={threadRoot.id}
          subtitle={threadSubtitle}
          following={threadQuery.data?.find((row) => row.id === threadRoot.id)?.thread_following ?? false}
          onClose={() => {
            closeThread();
            onFocusComposer?.();
          }}
        />
      ) : null}
      {anchorMessages && activeAnchorId && (onClearAnchor || localAnchorId) ? (
        <ChatAnchorBar onBackToLatest={clearAnchor} />
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* A log, but a silent one: the virtual list mounts rows as it
            scrolls, and a live log would read each of them out. What is new
            is said once, by NativeChatLiveRegion. */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          // A size container: a message's actions bar fits itself to the timeline's width.
          className={cn(
            "@container/timeline min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none]",
            chatWall.className,
          )}
          style={chatWall.style}
          role="log"
          aria-live="off"
          aria-label={t("chat.messages_region")}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard to scroll it (axe scrollable-region-focusable)
          tabIndex={0}
        >
          {/* Full width of the conversation column; side thread stays tighter (canvas). */}
          <div
            className={
              sideThreadPanel ? "w-full p-4" : `w-full pt-5 pb-3 ${CHAT_CONVERSATION_GUTTER}`
            }
          >
            <div className="w-full">
            <ChatLinkPreviewsProvider workspaceId={workspaceId} roomId={roomId} messages={messages}>
              <ChatMessageLinksProvider value={linksValue}>
                <ChatPeerReadAtContext.Provider value={receiptReadAt}>
                  <ChatForwardContext.Provider value={actions.onForward ?? null}>
                    <VirtualChatMessageList
                      key={roomId}
                      messages={messages}
                      getItemKey={getVirtualRowKey}
                      getEstimateSize={getVirtualRowEstimate}
                      scrollRef={scrollRef}
                      stickToBottomRef={stickToBottomRef}
                      programmaticScrollRef={programmaticScrollRef}
                      olderPrefetchSentinelRef={olderPrefetchSentinelRef}
                      highlightMessageId={highlightMessageId}
                      onHighlightShown={handleHighlightShown}
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
                  </ChatForwardContext.Provider>
                </ChatPeerReadAtContext.Provider>
              </ChatMessageLinksProvider>
            </ChatLinkPreviewsProvider>
            {threadRoot || anchorMessages ? null : <ChatTypingBubble userIds={typingUserIds} nameContext={nameContext} />}
            </div>
          </div>
        </div>
        <NativeChatLiveRegion
          roomId={roomId}
          messages={messages}
          currentUserId={currentUserId}
          senderLabelOf={senderLabelOf}
        />
        {awayFromLatest && !threadRoot && !activeAnchorId ? (
          <ChatJumpToLatestButton onClick={scrollToLatest} newCount={countNewSince(messages, awaySinceId, currentUserId)} />
        ) : null}
      </div>
      {actionDialogs}
      {taskLinkDialogs}
    </div>
  );
}

