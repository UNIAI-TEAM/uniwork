"use client";

import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listChatRoomMessagesAround } from "@uniwork/core/api/endpoints/chat";
import { isPendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import { toastChatError } from "./chat-error-message";
import type { ChatMessage } from "./chat-messages";
import { toChatMessage } from "./native-chat-message-mapping";
import { focusChatMessage } from "./use-native-chat-message-actions";

type Setter<T> = Dispatch<SetStateAction<T>>;

/**
 * Loads the window around a jump target. A failed or empty answer leaves the
 * anchor, pins the newest row and says so (the room never sits on a blank window).
 */
export function useAnchorWindowLoad(args: {
  workspaceId: string;
  roomId: string;
  activeAnchorId: string | null | undefined;
  stickToBottomRef: RefObject<boolean>;
  programmaticScrollRef: RefObject<boolean>;
  onClearAnchorRef: RefObject<(() => void) | undefined>;
  setAnchorMessages: Setter<ChatMessage[] | null>;
  setHighlightMessageId: Setter<string | null>;
  setLoadingAnchor: Setter<boolean>;
  setAwayFromLatest: Setter<boolean>;
  setLocalAnchor: Setter<{ roomId: string; id: string } | null>;
}): void {
  const { t } = useTranslation();
  const { workspaceId, roomId, activeAnchorId, stickToBottomRef, programmaticScrollRef, onClearAnchorRef } = args;
  const { setAnchorMessages, setHighlightMessageId, setLoadingAnchor, setAwayFromLatest, setLocalAnchor } = args;
  useEffect(() => {
    if (!activeAnchorId) {
      setAnchorMessages(null);
      setHighlightMessageId(null);
      setLoadingAnchor(false);
      return;
    }
    let cancelled = false;
    stickToBottomRef.current = false;
    setLoadingAnchor(true);
    const failAnchorJump = (err: unknown) => {
      stickToBottomRef.current = true;
      programmaticScrollRef.current = false;
      setAwayFromLatest(false);
      setAnchorMessages(null);
      setLocalAnchor(null);
      onClearAnchorRef.current?.();
      toastChatError(err, t, t("chat.message_list.jump_failed"));
    };
    void listChatRoomMessagesAround(workspaceId, roomId, activeAnchorId)
      .then((rows) => {
        if (cancelled) return;
        if (rows.length === 0) {
          failAnchorJump(null);
          return;
        }
        setAnchorMessages(rows.map(toChatMessage));
        setHighlightMessageId(activeAnchorId);
        stickToBottomRef.current = false;
      })
      .catch((err: unknown) => {
        // The message is gone or unreachable: say so instead of doing nothing.
        if (cancelled) return;
        failAnchorJump(err);
      })
      .finally(() => {
        if (!cancelled) setLoadingAnchor(false);
      });
    return () => {
      // A superseded or cleared request must not leave the spinner behind.
      cancelled = true;
      setLoadingAnchor(false);
    };
    // The setters and refs are stable: it re-runs on the anchor, the room, the workspace or t.
  }, [activeAnchorId, roomId, t, workspaceId, stickToBottomRef, programmaticScrollRef, onClearAnchorRef, setAnchorMessages, setHighlightMessageId, setLoadingAnchor, setAwayFromLatest, setLocalAnchor]);
}

/**
 * A jump's highlight clears 5 s after it is set, or 2.5 s after the row is
 * actually on screen (the returned `onHighlightShown`), whichever is set last.
 */
export function useChatHighlightFlash(
  highlightMessageId: string | null,
  setHighlightMessageId: Dispatch<SetStateAction<string | null>>,
): (messageId: string) => void {
  const highlightTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!highlightMessageId) return;
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightMessageId((current) => (current === highlightMessageId ? null : current));
    }, 5000);
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [highlightMessageId, setHighlightMessageId]);

  return useCallback(
    (messageId: string) => {
      focusChatMessage(messageId);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => {
        highlightTimerRef.current = null;
        setHighlightMessageId((current) => (current === messageId ? null : current));
      }, 2500);
    },
    [setHighlightMessageId],
  );
}

/** The typing bubble grows the timeline under the newest row: stay pinned to it. */
export function useTypingKeepsPinned(
  someoneTyping: boolean,
  scrollRef: RefObject<HTMLDivElement | null>,
  stickToBottomRef: RefObject<boolean>,
): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (someoneTyping && el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [someoneTyping, scrollRef, stickToBottomRef]);
}

/**
 * Own optimistic / pending sends must keep the viewport on the newest row,
 * and leave an open anchor window so the sent message is visible at the bottom.
 */
export function useOwnSendFollowsLatest(args: {
  timelineMessages: ChatMessage[];
  roomId: string;
  anchored: boolean;
  activeAnchorId: string | null | undefined;
  currentUserId: string | null | undefined;
  latestRefetching: boolean;
  clearAnchor: () => void;
  stickToBottomRef: RefObject<boolean>;
}): void {
  const { timelineMessages, roomId, anchored, activeAnchorId, currentUserId, latestRefetching, clearAnchor, stickToBottomRef } = args;
  const lastTimelineMessage = timelineMessages[timelineMessages.length - 1];
  const prevLastTimelineRef = useRef<{ roomId: string; anchored: boolean; id: string | undefined }>({
    roomId,
    anchored: false,
    id: undefined,
  });
  useEffect(() => {
    const prev = prevLastTimelineRef.current;
    const prevId = prev.roomId === roomId && prev.anchored === anchored ? prev.id : undefined;
    prevLastTimelineRef.current = { roomId, anchored, id: latestRefetching ? undefined : lastTimelineMessage?.id };
    if (!lastTimelineMessage) return;
    const isPendingOrQueued =
      lastTimelineMessage.deliveryStatus === "sending" ||
      lastTimelineMessage.deliveryStatus === "queued" ||
      isPendingChatMessageId(lastTimelineMessage.id);
    const isOwnMessage = isPendingOrQueued || lastTimelineMessage.sender === currentUserId;
    if (!isOwnMessage) return;
    if (anchored || activeAnchorId) {
      if (
        prevId !== lastTimelineMessage.id &&
        (isPendingOrQueued || (anchored && !latestRefetching && prevId !== undefined))
      ) {
        clearAnchor();
      }
      return;
    }
    stickToBottomRef.current = true;
  }, [activeAnchorId, anchored, clearAnchor, currentUserId, lastTimelineMessage, latestRefetching, roomId, stickToBottomRef]);
}
