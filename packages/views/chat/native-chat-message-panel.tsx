"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { mergeOptimisticChatMessages } from "@uniwork/core/chat/merge-optimistic-chat-messages";
import { usePendingChatMessagesStore } from "@uniwork/core/chat/pending-messages-store";
import { useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import { listChatRoomMessages, listChatRoomMessagesAround } from "@uniwork/core/api/endpoints/chat";
import {
  useChatRoomMessages,
  useClearDeliveredChatSends,
  useDeleteChatMessage,
  useEditChatMessage,
  useToggleChatMessagePin,
  useToggleChatReaction,
} from "@uniwork/core/chat";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import { serializeComposerDraftToMessageBody } from "./chat-mention-utils";
import { ChatMessageEditDialog } from "./chat-message-edit-dialog";
import { ChatMessageRow } from "./chat-message-row";
import type { ChatMessage } from "./chat-messages";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import { CHAT_MESSAGE_INITIAL, CHAT_MESSAGE_MAX_IN_MEMORY, CHAT_MESSAGE_PAGE_SIZE } from "./chat-messages";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import { ChatPollMessageRow } from "./chat-poll-message-row";
import { ChatReminderMessageRow } from "./chat-reminder-message-row";
import { ChatNoteMessageRow } from "./chat-note-message-row";
import { VoiceCallLogRow } from "./voice-call-log-row";
import { ChatVoiceMessageRow } from "./chat-voice-message-row";
import { VirtualChatMessageList } from "./virtual-chat-message-list";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { senderLabelFor, toChatMessage } from "./native-chat-message-mapping";
import { messageGrouping } from "./native-chat-message-grouping";

export function NativeChatMessagePanel({
  workspaceId,
  roomId,
  currentUserId,
  nameContext,
  emptyLabel,
  youLabel,
  replyTo,
  onReplyToChange,
  refreshKey,
  showSenderName = false,
  embedded = false,
  anchorMessageId = null,
  onClearAnchor,
  canPinMessages = true,
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
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [threadRoot, setThreadRoot] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [anchorMessages, setAnchorMessages] = useState<ChatMessage[] | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [loadingAnchor, setLoadingAnchor] = useState(false);
  const { data: latestRows = [] } = useChatRoomMessages(workspaceId, roomId, CHAT_MESSAGE_INITIAL);
  useClearDeliveredChatSends(latestRows);
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
    },
    [onReplyToChange],
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

  const handleCopy = useCallback(
    async (message: ChatMessage) => {
      try {
        await navigator.clipboard.writeText(message.body);
      } catch {
        // Clipboard may be unavailable in tests or insecure contexts.
      }
    },
    [],
  );

  const handleDelete = useCallback(
    async (message: ChatMessage) => {
      await deleteMessage.mutateAsync({ roomId, messageId: message.id });
      if (replyTo?.id === message.id) onReplyToChange(null);
      if (threadRoot?.id === message.id) setThreadRoot(null);
    },
    [deleteMessage, onReplyToChange, replyTo?.id, roomId, threadRoot?.id],
  );

  const allMessages = useMemo(() => {
    if (anchorMessages) return anchorMessages;
    const latest = latestRows.map(toChatMessage);
    const mergedLatest = mergeOptimisticChatMessages(
      latest,
      pendingEntries,
      outboxEntries,
      currentUserId,
    ) as ChatMessage[];
    if (olderMessages.length === 0) return mergedLatest;
    const seen = new Set<string>();
    const merged: ChatMessage[] = [];
    for (const message of [...olderMessages, ...mergedLatest]) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
    return merged.sort((a, b) => a.ts - b.ts);
  }, [anchorMessages, currentUserId, latestRows, olderMessages, outboxEntries, pendingEntries]);

  const messages = useMemo(() => {
    if (!threadRoot) return allMessages;
    return allMessages.filter(
      (message) =>
        message.id === threadRoot.id || message.replyToEventId === threadRoot.id,
    );
  }, [allMessages, threadRoot]);

  useEffect(() => {
    stickToBottomRef.current = true;
    onReplyToChange(null);
    setOlderMessages([]);
    setThreadRoot(null);
    setAnchorMessages(null);
    setHighlightMessageId(null);
    setHasMore(latestRows.length >= CHAT_MESSAGE_INITIAL);
  }, [roomId, onReplyToChange, latestRows.length]);

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

  useEffect(() => {
    if (refreshKey == null || refreshKey === 0) return;
    setOlderMessages([]);
  }, [refreshKey]);

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
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 72;
    if (el.scrollTop <= 72 && hasMore && !loadingOlder) {
      void loadOlder();
    }
  };

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const renderMessage = useCallback(
    (index: number) => {
      const message = messages[index];
      if (!message) return null;
      if (message.kind === "reminder" && message.reminder) {
        const { compactTop } = messageGrouping(messages, index);
        return (
          <ChatReminderMessageRow
            key={message.id}
            reminder={message.reminder}
            senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
            showSenderName={showSenderName}
            compactTop={compactTop}
          />
        );
      }
      if (message.kind === "note" && message.note) {
        const { compactTop } = messageGrouping(messages, index);
        return (
          <ChatNoteMessageRow
            key={message.id}
            note={message.note}
            senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
            showSenderName={showSenderName}
            compactTop={compactTop}
          />
        );
      }
      if (message.kind === "poll" && message.poll) {
        const { compactTop } = messageGrouping(messages, index);
        return (
          <ChatPollMessageRow
            key={message.id}
            messageId={message.id}
            workspaceId={workspaceId}
            roomId={roomId}
            poll={message.poll}
            senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
            showSenderName={showSenderName}
            compactTop={compactTop}
            nameContext={nameContext}
            currentUserId={currentUserId}
            youLabel={youLabel}
          />
        );
      }
      if (message.kind === "voice_call_log" || message.voiceCall) {
        return (
          <VoiceCallLogRow
            key={message.id}
            message={message}
            currentUserId={currentUserId}
          />
        );
      }
      if (message.kind === "voice" && message.voice) {
        const isOwn = message.sender === currentUserId;
        const { compactTop, showAvatar } = messageGrouping(messages, index);
        return (
          <ChatVoiceMessageRow
            key={message.id}
            workspaceId={workspaceId}
            roomId={roomId}
            message={message}
            senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
            isOwn={isOwn}
            showSenderName={showSenderName}
            compactTop={compactTop}
            showAvatar={showAvatar}
          />
        );
      }
      const isOwn = message.sender === currentUserId;
      const isPending = Boolean(message.deliveryStatus) || isPendingChatMessageId(message.id);
      const replyTarget = message.replyToEventId
        ? messagesById.get(message.replyToEventId)
        : undefined;
      const { compactTop, showAvatar } = messageGrouping(messages, index);
      return (
        <ChatMessageRow
          key={message.id}
          message={message}
          isOwn={isOwn}
          showReadReceipt={false}
          senderLabel={senderLabelFor(message, currentUserId, youLabel, nameContext)}
          replyPreview={replyTarget?.body}
          onReply={isPending ? undefined : onReplyToChange}
          onReact={isPending ? undefined : handleReact}
          onThread={isPending ? undefined : handleThread}
          onEdit={isPending ? undefined : handleEdit}
          onPin={isPending || !canPinMessages ? undefined : handlePin}
          onCopy={isPending ? undefined : handleCopy}
          onDelete={isPending ? undefined : handleDelete}
          showSenderName={showSenderName}
          compactTop={compactTop}
          nameContext={nameContext}
          showAvatar={showAvatar}
          highlighted={message.id === highlightMessageId}
        />
      );
    },
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
      roomId,
      showSenderName,
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
          messages={messages}
          scrollRef={scrollRef}
          stickToBottomRef={stickToBottomRef}
          highlightMessageId={highlightMessageId}
          header={listHeader}
          empty={<p className="text-body text-muted-foreground">{emptyLabel}</p>}
          renderMessage={renderMessage}
        />
      </div>
      {replyTo ? (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface/90 px-4 py-2 backdrop-blur-sm">
          <p className="min-w-0 truncate text-caption text-muted-foreground">
            {t("chat.replying_to", { preview: replyTo.body })}
          </p>
          <button
            type="button"
            className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => onReplyToChange(null)}
          >
            {t("chat.cancel_reply")}
          </button>
        </div>
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
    </div>
  );
}
