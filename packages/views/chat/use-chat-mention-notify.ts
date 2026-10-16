"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { chatKeys } from "@uniwork/core/chat";
import { useOptionalWS } from "@uniwork/core/realtime";

export function useChatMentionNotify({
  workspaceId,
  currentUserId,
  activeRoomId,
}: {
  workspaceId: string;
  currentUserId: string;
  activeRoomId: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ws = useOptionalWS()?.client ?? null;

  useEffect(() => {
    if (!ws || !currentUserId) return;
    const off = ws.on("chat.mention.created", (payload) => {
      const rawRoomId = (payload as { room_id?: unknown } | null | undefined)?.room_id;
      if (typeof rawRoomId !== "string") return;
      const roomId = rawRoomId.trim();
      if (!roomId || roomId === activeRoomId) return;
      const rooms = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId));
      if (rooms?.some((room) => room.id === roomId && room.notifications_muted)) return;
      toast.info(t("chat.mention_toast"), {
        description: t("chat.mention_toast_hint"),
      });
    });
    return off;
  }, [activeRoomId, currentUserId, qc, t, workspaceId, ws]);
}
