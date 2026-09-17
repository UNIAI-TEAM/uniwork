"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  patchTaskLabelCaches,
  rollbackTaskCacheWrites,
  taskKeys,
  useAttachTaskLabel,
  useDetachTaskLabel,
  withLabelSorted,
  withoutLabelId,
  type TaskCacheWrite,
} from "@uniwork/core/tasks";
import type { TaskLabel } from "@uniwork/core/types";
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
 * `labels` is the workspace label catalog (the table cell and the detail
 * sidebar both already hold it, for the picker's own choices) — it is where
 * an attach's optimistic `{id, name, color}` comes from. Before the request
 * goes out, `toggle` cancels in-flight table-rows fetches, then patches the task's row in every cached
 * `taskKeys.tableRoot(workspaceId)` table-rows page (`patchTaskLabelCaches`
 * in core, mirroring `patchTaskPropertyCaches`): the table cell reads a row's
 * `labels` straight off that cache, no per-row query (task 18), so that's
 * what has to change for the chip to update without waiting on a round trip.
 * A failure rolls the patch back (`rollbackTaskCacheWrites`) before toasting.
 * Either way, `taskKeys.tableRoot(workspaceId)` is invalidated once the
 * request settles, so the optimistic write is only ever a bridge to the
 * server's answer.
 */
export function useTaskLabelToggle(workspaceId: string, taskId: string, labels: TaskLabel[]) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const attach = useAttachTaskLabel(workspaceId, taskId);
  const detach = useDetachTaskLabel(workspaceId, taskId);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback(
    (labelId: string, checked: boolean) => {
      setPendingIds((prev) => new Set(prev).add(labelId));

      void (async () => {
        // A rows fetch already under way would land after the patch below and
        // put the old labels back.
        await qc.cancelQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
        let writes: TaskCacheWrite[] = [];
        if (checked) {
          const catalogLabel = labels.find((label) => label.id === labelId);
          if (catalogLabel) {
            const { id, name, color } = catalogLabel;
            writes = patchTaskLabelCaches(qc, workspaceId, taskId, (current) =>
              withLabelSorted(current, { id, name, color }),
            );
          }
        } else {
          writes = patchTaskLabelCaches(qc, workspaceId, taskId, (current) => withoutLabelId(current, labelId));
        }

        const run = checked ? attach.mutateAsync : detach.mutateAsync;
        await run(labelId)
          .catch((err: unknown) => {
            rollbackTaskCacheWrites(qc, writes);
            toastApiError(err, t("common.error"));
          })
          .finally(() => {
            setPendingIds((prev) => without(prev, labelId));
            void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
          });
      })();
    },
    [attach.mutateAsync, detach.mutateAsync, labels, qc, t, taskId, workspaceId],
  );

  return { toggle, pendingIds };
}
