"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { signalChatTyping } from "@uniwork/core/api/endpoints/chat";
import { useOptionalWS } from "@uniwork/core/realtime";
import { formatTypingLabel } from "./typing-indicator";

const TYPING_TTL_MS = 3_000;
const TYPING_DEBOUNCE_MS = 600;

export function useNativeTyping({
  workspaceId,
  roomId,
  currentUserId,
  nameContext,
  draft,
  enabled,
}: {
  workspaceId: string;
  roomId: string | null;
  currentUserId: string;
  nameContext: Array<{ user_id: string; display_name: string }>;
  draft: string;
  enabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const ws = useOptionalWS()?.client ?? null;
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!ws || !roomId) {
      setTypingUserIds([]);
      return;
    }

    const timers = timersRef.current;

    const bumpTyping = (userId: string) => {
      if (userId === currentUserId) return;
      setTypingUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
      const existing = timersRef.current.get(userId);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        userId,
        setTimeout(() => {
          timersRef.current.delete(userId);
          setTypingUserIds((prev) => prev.filter((id) => id !== userId));
        }, TYPING_TTL_MS),
      );
    };

    const off = ws.on("chat.typing", (payload) => {
      const data = payload as { room_id?: string; user_id?: string };
      if (!data.room_id || !data.user_id || data.room_id !== roomId) return;
      bumpTyping(data.user_id);
    });

    return () => {
      off();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      setTypingUserIds([]);
    };
  }, [ws, roomId, currentUserId]);

  useEffect(() => {
    if (!enabled || !roomId || !draft.trim()) return;
    const timer = setTimeout(() => {
      void signalChatTyping(workspaceId, roomId);
    }, TYPING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, roomId, workspaceId, enabled]);

  const typingLabel = useMemo(() => {
    if (!enabled || typingUserIds.length === 0) return null;
    const names = typingUserIds.map((userId) => {
      const match = nameContext.find((entry) => entry.user_id === userId);
      return match?.display_name?.trim() || userId;
    });
    return formatTypingLabel(names, t, i18n.language);
  }, [typingUserIds, nameContext, t, i18n.language, enabled]);

  return typingLabel;
}
