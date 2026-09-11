"use client";

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { signalChatTyping } from "@uniwork/core/api/endpoints/chat";
import {
  selectSidebarTypingUserIds,
  useSidebarTypingStore,
} from "@uniwork/core/chat/sidebar-typing-store";
import { formatTypingLabel } from "./typing-indicator";

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
  const typingUserIds = useSidebarTypingStore(
    useShallow((state) => selectSidebarTypingUserIds(state, roomId)),
  );

  useEffect(() => {
    if (!enabled || !roomId || !draft.trim()) return;
    const timer = setTimeout(() => {
      void signalChatTyping(workspaceId, roomId);
    }, TYPING_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, roomId, workspaceId, enabled]);

  return useMemo(() => {
    if (!enabled || typingUserIds.length === 0) return null;
    const names = typingUserIds.map((userId) => {
      const match = nameContext.find(
        (entry) => entry.user_id.trim().toUpperCase() === userId,
      );
      return match?.display_name?.trim() || userId;
    });
    return formatTypingLabel(names, t, i18n.language);
  }, [typingUserIds, nameContext, t, i18n.language, enabled]);
}
