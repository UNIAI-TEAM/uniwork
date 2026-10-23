"use client";

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { signalChatTyping } from "@uniwork/core/api/endpoints/chat";
import { useChatComposerDraftStore } from "@uniwork/core/chat/composer-draft-store";
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
  draftKey,
  enabled,
}: {
  workspaceId: string;
  roomId: string | null;
  currentUserId: string;
  nameContext: Array<{ user_id: string; display_name: string }>;
  /** The composer draft to watch; read from the store, so typing does not re-render the caller. */
  draftKey: string;
  enabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const typingUserIds = useSidebarTypingStore(
    useShallow((state) => selectSidebarTypingUserIds(state, roomId)),
  );

  // Signal "typing" a moment after the draft stops changing, as before, but
  // by subscribing to the store: the page that calls this does not re-render
  // on every keystroke.
  useEffect(() => {
    if (!enabled || !roomId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useChatComposerDraftStore.subscribe((state, previous) => {
      const next = state.drafts[draftKey] ?? "";
      if (next === (previous.drafts[draftKey] ?? "")) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!next.trim()) return;
      timer = setTimeout(() => {
        void signalChatTyping(workspaceId, roomId);
      }, TYPING_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [draftKey, roomId, workspaceId, enabled]);

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
