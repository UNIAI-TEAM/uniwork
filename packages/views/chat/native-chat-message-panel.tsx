"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { listChatRoomMessages } from "@uniwork/core/api/endpoints/chat";
import { useChatRoomMessages, useToggleChatReaction } from "@uniwork/core/chat";
import { ChatMessageRow } from "./chat-message-row";
import type { ChatMessage } from "./chat-messages";
import { CHAT_MESSAGE_INITIAL, CHAT_MESSAGE_PAGE_SIZE } from "./chat-messages";
import { DEFAULT_QUICK_REACTION } from "./chat-reactions";
import { VoiceCallLogRow } from "./voice-call-log-row";

interface NameContextEntry {
  user_id: string;
  display_name: string;
}

function toChatMessage(record: ChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    sender: record.sender_id,
    body: record.body,
    kind: record.kind,
    ts: Date.parse(record.created_at),
    replyToEventId: record.reply_to_message_id,
    reactions: record.reactions ?? {},
    voiceCall: record.voice_call
      ? {
          outcome: record.voice_call.outcome,
          duration_seconds: record.voice_call.duration_seconds,
          caller_id: record.voice_call.caller_id,
        }
      : undefined,
  };
}

function senderLabelFor(
  message: ChatMessage,
  currentUserId: string,
  youLabel: string,
  nameContext: NameContextEntry[],
): string {
  if (message.sender === currentUserId) return youLabel;
  const match = nameContext.find((entry) => entry.user_id === message.sender);
  return match?.display_name?.trim() || message.sender;
}

function isBubbleMessage(message: ChatMessage): boolean {
  return message.kind !== "voice_call_log" && !message.voiceCall;
}

const MESSAGE_GROUP_MS = 5 * 60 * 1000;

function messageGrouping(
  messages: ChatMessage[],
  index: number,
): { compactTop: boolean; showAvatar: boolean } {
  const message = messages[index];
  if (!message || !isBubbleMessage(message)) {
    return { compactTop: false, showAvatar: true };
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (!prev || !isBubbleMessage(prev)) {
      return { compactTop: false, showAvatar: true };
    }
    const sameSender = prev.sender === message.sender;
    const closeInTime = message.ts - prev.ts < MESSAGE_GROUP_MS;
    return {
      compactTop: sameSender && closeInTime,
      showAvatar: !(sameSender && closeInTime),
    };
  }

  return { compactTop: false, showAvatar: true };
}

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
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const { data: latestRows = [] } = useChatRoomMessages(workspaceId, roomId, CHAT_MESSAGE_INITIAL);
  const toggleReaction = useToggleChatReaction(workspaceId);

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

  const messages = useMemo(() => {
    const latest = latestRows.map(toChatMessage);
    if (olderMessages.length === 0) return latest;
    const seen = new Set<string>();
    const merged: ChatMessage[] = [];
    for (const message of [...olderMessages, ...latest]) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
    return merged.sort((a, b) => a.ts - b.ts);
  }, [latestRows, olderMessages]);

  useEffect(() => {
    stickToBottomRef.current = true;
    onReplyToChange(null);
    setOlderMessages([]);
    setHasMore(latestRows.length >= CHAT_MESSAGE_INITIAL);
  }, [roomId, onReplyToChange, latestRows.length]);

  useEffect(() => {
    if (refreshKey == null || refreshKey === 0) return;
    setOlderMessages([]);
  }, [refreshKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || messages.length === 0) return;
    stickToBottomRef.current = false;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const oldest = messages[0];
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
        const merged = [...older.filter((m) => !seen.has(m.id)), ...prev];
        return merged.sort((a, b) => a.ts - b.ts);
      });
    } finally {
      setLoadingOlder(false);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight - prevHeight;
      });
    }
  }, [loadingOlder, messages, workspaceId, roomId]);

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

  return (
    <div className={embedded ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted/25 px-4 py-4"
        aria-label={t("chat.messages_region")}
      >
        {loadingOlder ? (
          <p className="mb-3 text-center text-caption text-muted-foreground">{t("chat.loading_older")}</p>
        ) : null}
        {!loadingOlder && hasMore ? (
          <p className="mb-3 text-center text-caption text-muted-foreground">{t("chat.scroll_for_older")}</p>
        ) : null}
        {messages.length === 0 ? (
          <p className="text-body text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="flex w-full max-w-full flex-col pb-2">
            {messages.map((message, index) => {
              if (message.kind === "voice_call_log" || message.voiceCall) {
                return (
                  <VoiceCallLogRow
                    key={message.id}
                    message={message}
                    currentUserId={currentUserId}
                  />
                );
              }
              const isOwn = message.sender === currentUserId;
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
                  onReply={onReplyToChange}
                  onReact={handleReact}
                  showSenderName={showSenderName}
                  compactTop={compactTop}
                  showAvatar={showAvatar}
                />
              );
            })}
          </div>
        )}
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
    </div>
  );
}
