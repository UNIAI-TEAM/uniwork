"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useArchive, useMarkAllRead, useMarkUnread, useUnarchive } from "@uniwork/core/notifications";
import type { Notification } from "@uniwork/core/types";

/** The server takes at most this many ids per request (notification.Service.maxIDs). */
const MAX_IDS = 200;

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS) out.push(ids.slice(i, i + MAX_IDS));
  return out;
}

const ARCHIVE_TOAST = "notifications-archived";
const MARK_ALL_TOAST = "notifications-marked-all";

/**
 * Archive and "mark all as read", each undoable from its toast — both are one
 * key or one click away and both move rows out of sight, so neither may be a
 * one-way door.
 *
 * Archives made in a quick run (e, e, e) share one toast whose count grows and
 * whose Undo brings back the whole run; the run ends when that toast closes.
 */
export function useUndoableTriage() {
  const { t } = useTranslation();
  const archive = useArchive();
  const unarchive = useUnarchive();
  const markAll = useMarkAllRead();
  const markUnread = useMarkUnread();
  const run = useRef<string[]>([]);

  const fail = () => toast.error(t("notifications.error"));
  const undoFailed = () => toast.error(t("notifications.undo_failed"));

  const archiveRow = (n: Notification) => {
    archive.mutate([n.id], {
      onError: fail,
      onSuccess: () => {
        run.current = [...run.current, n.id];
        const ids = run.current;
        const end = () => {
          if (run.current === ids) run.current = [];
        };
        toast.success(t("notifications.archived", { count: ids.length }), {
          id: ARCHIVE_TOAST,
          onDismiss: end,
          onAutoClose: end,
          action: {
            label: t("notifications.undo"),
            onClick: () => {
              end();
              for (const part of chunks(ids)) unarchive.mutate(part, { onError: undoFailed });
            },
          },
        });
      },
    });
  };

  const markAllRead = (workspaceId: string) => {
    markAll.mutate(workspaceId, {
      onError: fail,
      onSuccess: (ids) => {
        if (ids.length === 0) return;
        toast.success(t("notifications.marked_all", { count: ids.length }), {
          id: MARK_ALL_TOAST,
          action: {
            label: t("notifications.undo"),
            onClick: () => {
              for (const part of chunks(ids)) markUnread.mutate(part, { onError: undoFailed });
            },
          },
        });
      },
    });
  };

  return { archiveRow, markAllRead, markingAll: markAll.isPending };
}
