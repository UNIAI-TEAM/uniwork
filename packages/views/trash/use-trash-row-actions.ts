"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { usePurgeDocument, useRestoreDocument } from "@uniwork/core/documents/hooks-collections";
import { usePurgeProject, usePurgeTask, useRestoreProject, useRestoreTask } from "@uniwork/core/tasks";
import type { TrashItem } from "@uniwork/core/trash";
import { toastApiError } from "../toast-api-error";

export interface TrashRowActions {
  restore: (row: TrashItem) => void;
  /** Runs at once: the caller asks first. */
  purge: (row: TrashItem) => void;
  /** A restore or purge is in flight: the row commands stay focusable but do nothing. */
  busy: boolean;
}

/**
 * Restore and purge for a row of the shared trash, each through its own kind's
 * hook, which also refreshes the shared trash; the toast says how it went.
 */
export function useTrashRowActions(wsId: string): TrashRowActions {
  const { t } = useTranslation();
  const restoreTask = useRestoreTask(wsId);
  const purgeTask = usePurgeTask(wsId);
  const restoreProject = useRestoreProject(wsId);
  const purgeProject = usePurgeProject(wsId);
  const restoreDocument = useRestoreDocument(wsId);
  const purgeDocument = usePurgeDocument(wsId);

  const run = (row: TrashItem, restore: boolean): Promise<unknown> | null => {
    switch (row.kind) {
      case "task":
        return (restore ? restoreTask : purgeTask).mutateAsync(row.id);
      case "project":
        return (restore ? restoreProject : purgeProject).mutateAsync(row.id);
      case "document":
        return (restore ? restoreDocument : purgeDocument).mutateAsync(row.id);
      default:
        return null;
    }
  };
  const settle = (action: Promise<unknown> | null, done: string, failed: string) => {
    void action?.then(
      () => toast.success(done),
      (err: unknown) => toastApiError(err, failed),
    );
  };

  return {
    restore: (row) => settle(run(row, true), t("trash.restored"), t("trash.restore_failed")),
    purge: (row) => settle(run(row, false), t("trash.purged"), t("trash.purge_failed")),
    busy: [restoreTask, purgeTask, restoreProject, purgeProject, restoreDocument, purgeDocument].some(
      (mutation) => mutation.isPending,
    ),
  };
}
