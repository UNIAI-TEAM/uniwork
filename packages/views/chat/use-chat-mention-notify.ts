"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useChatRoomPreferencesStore } from "@uniwork/core/chat/room-preferences-store";
import { useOptionalWS } from "@uniwork/core/realtime";

export function useChatMentionNotify({
  currentUserId,
  activeRoomId,
}: {
  currentUserId: string;
  activeRoomId: string | null;
}) {
  const { t } = useTranslation();
  const ws = useOptionalWS()?.client ?? null;

  useEffect(() => {
    if (!ws || !currentUserId) return;
    const off = ws.on("chat.mention.created", (payload) => {
      const rawRoomId = (payload as { room_id?: unknown } | null | undefined)?.room_id;
      if (typeof rawRoomId !== "string") return;
      const roomId = rawRoomId.trim();
      if (!roomId || roomId === activeRoomId) return;
      if (useChatRoomPreferencesStore.getState().isNotificationsMuted(roomId)) return;
      toast.info(t("chat.mention_toast"), {
        description: t("chat.mention_toast_hint"),
      });
    });
    return off;
  }, [activeRoomId, currentUserId, t, ws]);
}
