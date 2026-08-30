"use client";

import { useEffect, useRef, useState } from "react";
import { RoomMemberEvent, type MatrixClient } from "matrix-js-sdk";
import { sendMatrixTyping, listTypingMatrixUserIds } from "./matrix-dm";

const TYPING_DEBOUNCE_MS = 800;
const TYPING_REFRESH_MS = 2_000;

export function useMatrixTyping(
  client: MatrixClient | null,
  roomId: string | null,
  myMatrixUserId: string | null,
): string[] {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);

  useEffect(() => {
    if (!client || !roomId || !myMatrixUserId) {
      setTypingUserIds([]);
      return;
    }

    const refresh = () => {
      setTypingUserIds(listTypingMatrixUserIds(client, roomId, myMatrixUserId));
    };

    refresh();
    const onTyping = (_event: unknown, member: { roomId?: string }) => {
      if (member.roomId === roomId) refresh();
    };
    client.on(RoomMemberEvent.Typing, onTyping);
    const timer = window.setInterval(refresh, TYPING_REFRESH_MS);

    return () => {
      client.removeListener(RoomMemberEvent.Typing, onTyping);
      window.clearInterval(timer);
      setTypingUserIds([]);
    };
  }, [client, roomId, myMatrixUserId]);

  return typingUserIds;
}

export function useMatrixTypingSender(
  client: MatrixClient | null,
  roomId: string | null,
  draft: string,
): void {
  const lastSentRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!client || !roomId) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);

    if (!draft.trim()) {
      if (lastSentRef.current) {
        void sendMatrixTyping(client, roomId, false);
        lastSentRef.current = false;
      }
      return;
    }

    timerRef.current = window.setTimeout(() => {
      void sendMatrixTyping(client, roomId, true);
      lastSentRef.current = true;
    }, TYPING_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [client, roomId, draft]);

  useEffect(() => {
    return () => {
      if (client && roomId && lastSentRef.current) {
        void sendMatrixTyping(client, roomId, false);
      }
    };
  }, [client, roomId]);
}
