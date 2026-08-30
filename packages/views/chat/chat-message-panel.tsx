"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RoomEvent } from "matrix-js-sdk";
import { displayNameForMatrixSender } from "@uniwork/core/chat/matrix-users";
import type { MatrixClient } from "matrix-js-sdk";
import {
  CHAT_MESSAGE_INITIAL,
  CHAT_MESSAGE_PAGE_SIZE,
  countRoomMessages,
  findMessageById,
  paginateOlderRoomMessages,
  readRoomMessages,
  roomHasOlderTimeline,
  type ChatMessage,
} from "./chat-messages";
import { ChatMessageRow } from "./chat-message-row";
import { sendMatrixReaction } from "./matrix-message-actions";
import { ownMessageIdWithReadReceipt } from "./matrix-read-receipts";

const SCROLL_LOAD_THRESHOLD_PX = 72;

interface NameContextEntry {
  user_id: string;
  display_name: string;
  matrix_user_id?: string | null;
}

export function ChatMessagePanel({
  client,
  roomId,
  currentUserId,
  myMatrixUserId,
  readReceiptReaderId,
  nameContext,
  emptyLabel,
  youLabel,
  replyTo,
  onReplyToChange,
}: {
  client: MatrixClient;
  roomId: string;
  currentUserId: string;
  myMatrixUserId: string;
  readReceiptReaderId?: string | null;
  nameContext: NameContextEntry[];
  emptyLabel: string;
  youLabel: string;
  replyTo: ChatMessage | null;
  onReplyToChange: (message: ChatMessage | null) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [visibleLimit, setVisibleLimit] = useState(CHAT_MESSAGE_INITIAL);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [receiptTick, setReceiptTick] = useState(0);

  const syncMessages = useCallback(() => {
    const next = readRoomMessages(client, roomId, { limit: visibleLimit });
    setMessages(next);
    setTotalLoaded(countRoomMessages(client, roomId));
  }, [client, roomId, visibleLimit]);

  useEffect(() => {
    setVisibleLimit(CHAT_MESSAGE_INITIAL);
    stickToBottomRef.current = true;
    onReplyToChange(null);
  }, [roomId, onReplyToChange]);

  useEffect(() => {
    syncMessages();
  }, [syncMessages]);

  useEffect(() => {
    const onTimeline = (ev: { getType: () => string }, mxRoom?: { roomId: string }) => {
      if (mxRoom?.roomId !== roomId) return;
      const type = ev.getType();
      if (type !== "m.room.message" && type !== "m.reaction") return;
      syncMessages();
    };
    const onReceipt = (_event: unknown, mxRoom?: { roomId: string }) => {
      if (mxRoom?.roomId !== roomId) return;
      setReceiptTick((value) => value + 1);
      syncMessages();
    };
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomEvent.Receipt, onReceipt);
    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline);
      client.removeListener(RoomEvent.Receipt, onReceipt);
    };
  }, [client, roomId, syncMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const readReceiptMessageId = useMemo(() => {
    void receiptTick;
    const room = client.getRoom(roomId);
    if (!room) return null;
    return ownMessageIdWithReadReceipt(room, messages, myMatrixUserId, readReceiptReaderId);
  }, [client, messages, myMatrixUserId, readReceiptReaderId, roomId, receiptTick]);

  const canLoadMore =
    totalLoaded > messages.length || roomHasOlderTimeline(client, roomId);

  const loadOlder = useCallback(async () => {
    if (loadingOlder) return;
    stickToBottomRef.current = false;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;

    try {
      if (totalLoaded > messages.length) {
        setVisibleLimit((prev) => prev + CHAT_MESSAGE_PAGE_SIZE);
      } else if (roomHasOlderTimeline(client, roomId)) {
        await paginateOlderRoomMessages(client, roomId);
        setVisibleLimit((prev) => prev + CHAT_MESSAGE_PAGE_SIZE);
      }
    } finally {
      setLoadingOlder(false);
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight - prevHeight;
      });
    }
  }, [client, loadingOlder, messages.length, roomId, totalLoaded]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < SCROLL_LOAD_THRESHOLD_PX;
    if (el.scrollTop <= SCROLL_LOAD_THRESHOLD_PX && canLoadMore && !loadingOlder) {
      void loadOlder();
    }
  };

  const handleReact = useCallback(
    (message: ChatMessage) => {
      void sendMatrixReaction(client, roomId, message.id).catch(() => undefined);
    },
    [client, roomId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
        aria-label={t("chat.messages_region")}
      >
        {loadingOlder ? (
          <p className="mb-3 text-center text-caption text-muted-foreground">{t("chat.loading_older")}</p>
        ) : null}
        {!loadingOlder && canLoadMore ? (
          <p className="mb-3 text-center text-caption text-muted-foreground">{t("chat.scroll_for_older")}</p>
        ) : null}
        {messages.length === 0 ? (
          <p className="text-body text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isOwn = message.sender === myMatrixUserId;
              const replyTarget = message.replyToEventId
                ? findMessageById(messages, message.replyToEventId)
                : undefined;
              return (
                <ChatMessageRow
                  key={message.id}
                  message={message}
                  isOwn={isOwn}
                  showReadReceipt={isOwn && message.id === readReceiptMessageId}
                  senderLabel={displayNameForMatrixSender(
                    message.sender,
                    nameContext,
                    currentUserId,
                    youLabel,
                  )}
                  replyPreview={replyTarget?.body}
                  onReply={onReplyToChange}
                  onReact={handleReact}
                />
              );
            })}
          </div>
        )}
      </div>
      {replyTo ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
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

export function useChatMessageCount(
  client: MatrixClient | null,
  roomId: string | null,
): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!client || !roomId) {
      setCount(0);
      return;
    }
    const refresh = () => setCount(countRoomMessages(client, roomId));
    refresh();
    const onTimeline = (ev: { getType: () => string }, mxRoom?: { roomId: string }) => {
      if (mxRoom?.roomId !== roomId) return;
      if (ev.getType() !== "m.room.message") return;
      refresh();
    };
    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline);
    };
  }, [client, roomId]);

  return count;
}
