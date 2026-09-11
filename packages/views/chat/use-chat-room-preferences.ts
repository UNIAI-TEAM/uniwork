"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";

export function useChatRoomPreferences(roomId: string | null | undefined) {
  const { t } = useTranslation();
  const notificationsMuted = useChatRoomPreferencesStore((state) =>
    roomId ? state.isNotificationsMuted(roomId) : false,
  );
  const pinned = useChatRoomPreferencesStore((state) => (roomId ? state.isPinned(roomId) : false));
  const toggleNotificationsMuted = useChatRoomPreferencesStore((state) => state.toggleNotificationsMuted);
  const togglePinned = useChatRoomPreferencesStore((state) => state.togglePinned);

  const onToggleMute = useCallback(() => {
    if (!roomId) return;
    toggleNotificationsMuted(roomId);
    const nextMuted = !notificationsMuted;
    toast.info(
      nextMuted ? t("chat.settings_notifications_muted_on") : t("chat.settings_notifications_muted_off"),
    );
  }, [notificationsMuted, roomId, t, toggleNotificationsMuted]);

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
