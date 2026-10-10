"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { chatKeys } from "@uniwork/core/chat";
import { reminderBodyLabel } from "@uniwork/core/chat/reminder-utils";
import { flattenRoomTimeline, type RoomTimeline } from "@uniwork/core/chat/room-timeline";
import { useOptionalWS } from "@uniwork/core/realtime";

type ReminderDuePayload = { room_id?: unknown; message_id?: unknown } | null | undefined;

/**
 * Toasts a chat reminder when the server's reminder worker says it is due
 * (`chat.reminder.due`). The server also files the inbox notification and the
 * push, so this is only the in-page echo: there is no client timer, and a
 * reminder fires whether or not this page was open.
 */
export function useChatReminderNotifications(workspaceId: string): void {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ws = useOptionalWS()?.client ?? null;

  useEffect(() => {
    if (!ws) return;
    return ws.on("chat.reminder.due", (payload) => {
      const messageId = (payload as ReminderDuePayload)?.message_id;
      if (typeof messageId !== "string" || !messageId) return;
      // The frame carries ids only; the body comes from whatever room is cached.
      let row: ChatMessageRecord | undefined;
      for (const [, data] of qc.getQueriesData<RoomTimeline>({ queryKey: chatKeys.roomMessagesRoot(workspaceId) })) {
        row = data && flattenRoomTimeline(data).find((r) => r.id === messageId);
        if (row) break;
      }
      toast.info(t("chat.reminder_due_toast", { body: reminderBodyLabel({ body: row?.reminder?.body ?? row?.body }) }));
    });
  }, [qc, workspaceId, t, ws]);
}
