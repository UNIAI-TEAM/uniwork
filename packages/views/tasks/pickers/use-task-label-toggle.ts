"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { taskKeys, useAttachTaskLabel, useDetachTaskLabel } from "@uniwork/core/tasks";
import { toastApiError } from "../../toast-api-error";

function without(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

/**
 * Attach/detach one label on a task, with the error surfaced as a toast for
 * both directions. Shared by the table cell and the detail sidebar so neither
 * can drift back to a silent failure.
 *
 * Uses `mutateAsync(...).catch` rather than `mutate(id, { onError })`: TanStack
 * only runs per-call callbacks for the latest call on an observer, and a
 * multi-select menu routinely fires a second toggle before the first settles —
 * the first failure would otherwise vanish.
 *
 * `pendingIds` tracks in-flight toggles per label, so a label mid-request can't
 * be double-toggled while the other labels in the same menu stay clickable.
 *
 * A successful toggle also invalidates `taskKeys.tableRoot(workspaceId)`: the
 * table cell reads its row's `labels` straight off the table-rows cache (no
 * per-row query), so that cache is what has to refresh for the picker and the
 * chips to catch up.
 */
export function useTaskLabelToggle(workspaceId: string, taskId: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const attach = useAttachTaskLabel(workspaceId, taskId);
  const detach = useDetachTaskLabel(workspaceId, taskId);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback(
    (labelId: string, checked: boolean) => {
      setPendingIds((prev) => new Set(prev).add(labelId));
      const run = checked ? attach.mutateAsync : detach.mutateAsync;
      void run(labelId)
        .then(() => {
          void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
        })
        .catch((err: unknown) => toastApiError(err, t("common.error")))
        .finally(() => setPendingIds((prev) => without(prev, labelId)));
    },
    [attach.mutateAsync, detach.mutateAsync, qc, t, workspaceId],
  );

  return { toggle, pendingIds };
}
