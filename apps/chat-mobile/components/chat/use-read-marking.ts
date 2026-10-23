// When a room counts as read, mirroring the web
// (packages/views/chat/use-chat-catch-up-ui.ts and
// packages/core/chat/use-mark-chat-room-read-at-latest.ts): on opening it, on
// leaving it, and while it is on screen with the app in front, once a newer
// message has stayed at the bottom for 1.5 s. It is also the room the socket
// subscribes first and whose messages are not counted unread.
import { useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { useMarkRoomRead } from "@/data/mutations/messages";
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

// The screen that set the active room last. A thread over its room focuses
// before the room blurs; the room's cleanup must not clear the thread's room.
let activeOwner: object | null = null;

/** The room on screen while this screen is focused; `onFocus` runs each time it is. */
export function useActiveRoom(roomId: string, onFocus?: () => (() => void) | void) {
  useFocusEffect(
    useCallback(() => {
      const owner = {};
      activeOwner = owner;
      useActiveChatRoomStore.getState().setRoomId(roomId);
      const cleanup = onFocus?.();
      return () => {
        if (activeOwner === owner) {
          activeOwner = null;
          useActiveChatRoomStore.getState().setRoomId(null);
        }
        cleanup?.();
      };
    }, [roomId, onFocus]),
  );
}

export function useRoomReadMarking(wsId: string, roomId: string, newestMessageId: string | null, atLatest: boolean) {
  const markRoomRead = useMarkRoomRead();
  // In front: the app is active and no thread or details screen covers the room.
  const appActive = useAppActive();
  const focused = useIsFocused();
  const active = appActive && focused;
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // A read that cannot go now is queued and retried (data/pending-ops.ts); one the server refuses is reported there.
  const onFocus = useCallback(() => {
    if (!userId) return;
    markRoomRead(wsId, roomId, userId);
    return () => markRoomRead(wsId, roomId, userId);
  }, [markRoomRead, wsId, roomId, userId]);
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
    if (last.messageId === newestMessageId || !atLatest || !active || !userId) return;
    const timer = setTimeout(() => {
      marked.current = { roomId, messageId: newestMessageId };
      markRoomRead(wsId, roomId, userId);
    }, CHAT_READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, atLatest, newestMessageId, markRoomRead, roomId, wsId, userId]);
}
