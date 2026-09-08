"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { reminderBodyLabel } from "@uniwork/core/chat/reminder-utils";

type ServerReminderEntry = {
  id: string;
  roomId: string;
  body: string;
  remindAt: string;
};

function extractRemindersFromCache(
  queries: Array<{ state: { data: unknown } }>,
): ServerReminderEntry[] {
  const reminders: ServerReminderEntry[] = [];
  for (const query of queries) {
    const rows = query.state.data;
    if (!Array.isArray(rows)) continue;
    for (const row of rows as ChatMessageRecord[]) {
      if (row.kind !== "reminder" || !row.reminder) continue;
      reminders.push({
        id: row.id,
        roomId: row.room_id,
        body: row.reminder.body,
        remindAt: row.reminder.remind_at,
      });
    }
  }
  return reminders;
}

function remindersSnapshotKey(entries: ServerReminderEntry[]): string {
  return entries
    .map((entry) => `${entry.id}:${entry.remindAt}:${entry.body}`)
    .sort()
    .join("|");
}

export function useChatReminderNotifications(workspaceId: string): void {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const firedRef = useRef<Set<string>>(new Set());
  const timerIdsRef = useRef<number[]>([]);
  const snapshotKeyRef = useRef("");

  useEffect(() => {
    const clearTimers = () => {
      timerIdsRef.current.forEach((timerId) => window.clearTimeout(timerId));
      timerIdsRef.current = [];
    };

    const scheduleTimers = (reminders: ServerReminderEntry[]) => {
      clearTimers();

      for (const entry of reminders) {
        if (firedRef.current.has(entry.id)) continue;
        const remindAtMs = Date.parse(entry.remindAt);
        if (!Number.isFinite(remindAtMs)) continue;
        const delay = remindAtMs - Date.now();
        if (delay <= 0) continue;

        const timerId = window.setTimeout(() => {
          if (firedRef.current.has(entry.id)) return;
          firedRef.current.add(entry.id);
          toast.info(t("chat.reminder_due_toast", { body: reminderBodyLabel({ body: entry.body }) }));
        }, delay);

        timerIdsRef.current.push(timerId);
      }
    };

    const syncFromCache = () => {
      const queries = qc.getQueryCache().findAll({
        queryKey: ["chat", "room-messages", workspaceId],
        exact: false,
      });
      const reminders = extractRemindersFromCache(queries);
      const nextKey = remindersSnapshotKey(reminders);
      if (nextKey === snapshotKeyRef.current) return;
      snapshotKeyRef.current = nextKey;
      scheduleTimers(reminders);
    };

    syncFromCache();
    const unsubscribe = qc.getQueryCache().subscribe(syncFromCache);

    return () => {
      unsubscribe();
      clearTimers();
    };
  }, [qc, workspaceId, t]);
}
