"use client";

import { useEffect, useRef, useState } from "react";
import { useMarkChatRoomRead } from "./chat-hooks-rooms";

/** How long the newest message must stay in view before it counts as read. */
export const CHAT_READ_DEBOUNCE_MS = 1500;

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Advance the read pointer while the room is on screen: the tab is visible,
 * the reader is at the newest message, and a newer one than last marked has
 * stayed there for CHAT_READ_DEBOUNCE_MS (H6). The first newest message seen
 * in a room is not marked here: entering the room already did.
 */
export function useMarkChatRoomReadAtLatest(
  wsId: string,
  roomId: string,
  newestMessageId: string | null,
  atLatest: boolean,
): void {
  const { mutate } = useMarkChatRoomRead(wsId);
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const markedRef = useRef<{ roomId: string; messageId: string } | null>(null);
  const [visible, setVisible] = useState(documentVisible);

  useEffect(() => {
    const onChange = () => setVisible(documentVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  useEffect(() => {
    if (!newestMessageId) return;
    const marked = markedRef.current;
    if (marked?.roomId !== roomId) {
      markedRef.current = { roomId, messageId: newestMessageId };
      return;
    }
    if (marked.messageId === newestMessageId || !atLatest || !visible) return;
    const timer = setTimeout(() => {
      markedRef.current = { roomId, messageId: newestMessageId };
      mutateRef.current(roomId);
    }, CHAT_READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [atLatest, newestMessageId, roomId, visible]);
}
