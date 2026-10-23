"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useChatRooms, useSetChatRoomMuted } from "@uniwork/core/chat";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";

export function useChatRoomPreferences(workspaceId: string, roomId: string | null | undefined) {
  const { t } = useTranslation();
  // The mute is the server's (it stops push and inbox rows on every device).
  const { data: rooms } = useChatRooms(workspaceId);
  const notificationsMuted = Boolean(roomId && rooms?.find((room) => room.id === roomId)?.notifications_muted);
  const { mutate: setMuted } = useSetChatRoomMuted(workspaceId);
  const pinned = useChatRoomPreferencesStore((state) => (roomId ? state.isPinned(roomId) : false));
  const togglePinned = useChatRoomPreferencesStore((state) => state.togglePinned);

  const onToggleMute = useCallback(() => {
    if (!roomId) return;
    const nextMuted = !notificationsMuted;
    setMuted(
      { roomId, muted: nextMuted },
      {
        onSuccess: () =>
          toast.info(
            nextMuted ? t("chat.settings_notifications_muted_on") : t("chat.settings_notifications_muted_off"),
          ),
        onError: () => toast.error(t("common.error")),
      },
    );
  }, [notificationsMuted, roomId, setMuted, t]);

  const onTogglePin = useCallback(() => {
    if (!roomId) return;
    togglePinned(roomId);
    const nextPinned = !pinned;
    toast.info(nextPinned ? t("chat.settings_conversation_pinned_on") : t("chat.settings_conversation_pinned_off"));
  }, [pinned, roomId, t, togglePinned]);

  return {
    notificationsMuted,
    pinned,
    onToggleMute,
    onTogglePin,
  };
}
