"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { isDocumentNotInTrashError } from "@uniwork/core/documents/errors";
import { useRestoreDocument } from "@uniwork/core/documents/hooks-collections";
import { documentKeys } from "@uniwork/core/documents/keys";
import { usePurgeProject, usePurgeTask, useRestoreProject, useRestoreTask } from "@uniwork/core/tasks";
import { trashKeys, type TrashItem } from "@uniwork/core/trash";
import { createSafeId } from "@uniwork/core/utils";
import { trashErrorMessage } from "../documents/document-error-message";
import { toastDocumentRestored, trashedDescendants } from "../documents/use-trash-actions";
import { toastApiError } from "../toast-api-error";

export interface TrashRowActions {
  restore: (row: TrashItem) => void;
  /** A task or a project, at once: the caller asks first. A document purges through DocumentPurgeDialog. */
  purge: (row: TrashItem) => void;
  /** A restore or purge is in flight: the row commands stay focusable but do nothing. */
  busy: boolean;
}

/** Restored or purged elsewhere meanwhile: its kind answers 404, a document document_not_in_trash. */
function isGone(err: unknown): boolean {
  return isDocumentNotInTrashError(err) || (err instanceof ApiError && err.status === 404);
}

/**
 * Restore and purge for a row of the shared trash, each through its own kind's
 * hook, which also refreshes the shared trash. A document behaves as on the
 * Documents trash: an idempotency key, the toast that says where it landed and
 * whether listed children stayed behind (`rows` are the rows on screen before
 * the restore), and the documents error copy.
 */
export function useTrashRowActions(wsId: string, rows: readonly TrashItem[]): TrashRowActions {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const restoreTask = useRestoreTask(wsId);
  const purgeTask = usePurgeTask(wsId);
  const restoreProject = useRestoreProject(wsId);
  const purgeProject = usePurgeProject(wsId);
  const restoreDocument = useRestoreDocument(wsId);

  const failed = (row: TrashItem, action: "restore" | "purge") => (err: unknown) => {
    if (row.kind === "document") toast.error(trashErrorMessage(err, t, `documents.trash.${action}_failed`));
    else toastApiError(err, t(`trash.${action}_failed`));
    // The row is stale: reread the list so it leaves.
    if (!isGone(err)) return;
    void qc.invalidateQueries({ queryKey: trashKeys.workspace(wsId) });
    if (row.kind === "document") void qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
  };
  const done = (text: string) => () => {
    toast.success(text);
  };

  const restore = (row: TrashItem) => {
    if (row.kind === "task") void restoreTask.mutateAsync(row.id).then(done(t("trash.restored")), failed(row, "restore"));
    else if (row.kind === "project") void restoreProject.mutateAsync(row.id).then(done(t("trash.restored")), failed(row, "restore"));
    else if (row.kind === "document") {
      // The descendants this folder could leave behind are the rows listed BEFORE the restore.
      const left = row.sub_kind === "folder" ? trashedDescendants(row.id, rows.filter((r) => r.kind === "document")) : new Set<string>();
      void restoreDocument.mutateAsync({ documentId: row.id, idempotencyKey: createSafeId() }).then(
        (result) => toastDocumentRestored(t, result, row.title || t("documents.detail.untitled"), left),
        failed(row, "restore"),
      );
    }
  };
  const purge = (row: TrashItem) => {
    if (row.kind === "task") void purgeTask.mutateAsync(row.id).then(done(t("trash.purged")), failed(row, "purge"));
    else if (row.kind === "project") void purgeProject.mutateAsync(row.id).then(done(t("trash.purged")), failed(row, "purge"));
  };

  return {
    restore,
    purge,
    busy: [restoreTask, purgeTask, restoreProject, purgeProject, restoreDocument].some((mutation) => mutation.isPending),
  };
}
