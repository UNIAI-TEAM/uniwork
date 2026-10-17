// When a room counts as read, mirroring the web
// (packages/views/chat/use-chat-catch-up-ui.ts and
// packages/core/chat/use-mark-chat-room-read-at-latest.ts): on opening it, on
// leaving it, and while it is on screen with the app in front, once a newer
// message has stayed at the bottom for 1.5 s. It is also the room the socket
// subscribes first and whose messages are not counted unread.
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { markRoomRead } from "@/data/chat-actions";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";

const CHAT_READ_DEBOUNCE_MS = 1500;

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

/** The room on screen while this screen is focused; `onFocus` runs each time it is. */
export function useActiveRoom(roomId: string, onFocus?: () => (() => void) | void) {
  useFocusEffect(
    useCallback(() => {
      useActiveChatRoomStore.getState().setRoomId(roomId);
      const cleanup = onFocus?.();
      return () => {
        if (useActiveChatRoomStore.getState().roomId === roomId) useActiveChatRoomStore.getState().setRoomId(null);
        cleanup?.();
      };
    }, [roomId, onFocus]),
  );
}

export function useRoomReadMarking(wsId: string, roomId: string, newestMessageId: string | null, atLatest: boolean) {
  const qc = useQueryClient();
  const active = useAppActive();
  const onFocus = useCallback(() => {
    void markRoomRead(qc, wsId, roomId).catch(() => undefined);
    return () => void markRoomRead(qc, wsId, roomId).catch(() => undefined);
  }, [qc, wsId, roomId]);
  useActiveRoom(roomId, onFocus);

  const marked = useRef<{ roomId: string; messageId: string } | null>(null);
  useEffect(() => {
    if (!newestMessageId) return;
    const last = marked.current;
    // The first newest message seen here is not marked: opening the room already did.
    if (last?.roomId !== roomId) {
      marked.current = { roomId, messageId: newestMessageId };
      return;
    }
    if (last.messageId === newestMessageId || !atLatest || !active) return;
    const timer = setTimeout(() => {
      marked.current = { roomId, messageId: newestMessageId };
      void markRoomRead(qc, wsId, roomId).catch(() => undefined);
    }, CHAT_READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, atLatest, newestMessageId, qc, roomId, wsId]);
}
