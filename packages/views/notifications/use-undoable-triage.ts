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
  // mutateAsync, not mutate(…, callbacks): per-call callbacks fire only for the
  // latest call on the observer and never after unmount, which would drop rows
  // of a quick run from the undo, and the undo's own errors once the toast
  // outlives the inbox.
  const undo = (ids: string[], restore: (part: string[]) => Promise<unknown>) => {
    void Promise.all(chunks(ids).map((part) => restore(part))).catch(undoFailed);
  };

  const archiveRow = (n: Notification) => {
    void archive.mutateAsync([n.id]).then(
      () => {
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
              undo(ids, unarchive.mutateAsync);
            },
          },
        });
      },
      fail,
    );
  };

  const markAllRead = (workspaceId: string) => {
    void markAll.mutateAsync(workspaceId).then(
      (ids) => {
        if (ids.length === 0) return;
        toast.success(t("notifications.marked_all", { count: ids.length }), {
          id: MARK_ALL_TOAST,
          action: {
            label: t("notifications.undo"),
            onClick: () => undo(ids, markUnread.mutateAsync),
          },
        });
      },
      fail,
    );
  };

  return { archiveRow, markAllRead, markingAll: markAll.isPending };
}
