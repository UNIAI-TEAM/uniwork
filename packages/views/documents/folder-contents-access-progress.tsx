"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import type { FolderContentsAccessCounts } from "@uniwork/core/api/endpoints/documents-folder-contents-access";
import { useFolderContentsAccessBatch } from "@uniwork/core/documents/hooks-folder-contents-access";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Progress, ProgressLabel } from "@uniwork/ui/components/ui/progress";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/** The result toasts of a change: a settled one (a sync answer, or a background batch that completed), a batch that stopped part-way, and an apply whose answer could not be read. */
export function useFolderAccessToasts(): { applied: (counts: FolderContentsAccessCounts) => void; failed: () => void; unknown: () => void } {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      applied: (counts) => {
        // The lines under the title: what the person did not manage and what was locked, only when above 0.
        const lines: string[] = [];
        if (counts.skipped_not_manageable > 0) lines.push(t("documents.folderAccess.toast_skipped", { count: counts.skipped_not_manageable }));
        if (counts.skipped_locked > 0) lines.push(t("documents.folderAccess.toast_locked", { count: counts.skipped_locked }));
        toast.success(t("documents.folderAccess.toast_done", { count: counts.changed }), { description: lines.length > 0 ? lines.join(" ") : undefined });
      },
      failed: () => toast.error(t("documents.folderAccess.batch_failed")),
      unknown: () => toast.info(t("documents.folderAccess.toast_unknown")),
    }),
    [t],
  );
}

/**
 * Progress of one background batch: a bar of processed/total fed by the
 * batch poll (core stops it at completed/failed). The dialog may close without
 * cancelling the batch; `FolderContentsAccessWatcher` keeps the poll alive and
 * says the result.
 */
export function FolderContentsAccessProgress({
  wsId,
  folderId,
  batchId,
  alreadyRunning = false,
}: {
  wsId: string;
  folderId: string;
  batchId: string;
  /** A 409 sent the person here: the batch is someone's earlier run, not the one they just asked for. */
  alreadyRunning?: boolean;
}) {
  const { t } = useTranslation();
  const batch = useFolderContentsAccessBatch(wsId, folderId, batchId).data;
  const status = batch?.status;
  const total = batch?.total ?? 0;
  const processed = batch?.processed ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null;

  return (
    <section aria-label={t("documents.folderAccess.progress_title")} className="flex min-w-0 flex-col gap-3" data-testid="folder-access-progress">
      {alreadyRunning ? (
        <Alert variant="warning" role="status">
          <AlertDescription>{t("documents.folderAccess.progress_already_running")}</AlertDescription>
        </Alert>
      ) : null}
      {status === "failed" ? (
        <Alert variant="destructiveSoft">
          <AlertDescription>{t("documents.folderAccess.batch_failed")}</AlertDescription>
        </Alert>
      ) : status === "completed" ? (
        <p role="status" className="text-body font-medium break-words text-foreground">
          {t("documents.folderAccess.batch_done", { count: batch?.changed ?? 0 })}
        </p>
      ) : (
        <Progress value={percent} aria-valuetext={percent === null ? t("documents.folderAccess.progress_starting") : undefined} className="flex-col gap-2">
          <ProgressLabel className="flex items-center gap-2 text-body font-medium text-foreground">
            <Spinner aria-hidden role="presentation" />
            {t("documents.folderAccess.progress_label")}
          </ProgressLabel>
          <span className="text-caption text-muted-foreground tabular-nums" data-testid="folder-access-progress-count">
            {batch ? t("documents.folderAccess.progress_count", { count: total, processed }) : t("documents.folderAccess.progress_starting")}
          </span>
        </Progress>
      )}
      {status === "completed" || status === "failed" ? null : (
        <p className="text-caption break-words text-muted-foreground">{t("documents.folderAccess.progress_hint")}</p>
      )}
    </section>
  );
}

/**
 * Keeps one background batch polling after its dialog is closed and toasts once
 * when it completes or fails, then asks to be unmounted. It draws nothing.
 */
export function FolderContentsAccessWatcher({
  wsId,
  folderId,
  batchId,
  onSettled,
}: {
  wsId: string;
  folderId: string;
  batchId: string;
  onSettled: (batchId: string) => void;
}) {
  const toasts = useFolderAccessToasts();
  const query = useFolderContentsAccessBatch(wsId, folderId, batchId);
  const done = useRef(false);
  const batch = query.data;
  const status = batch?.status;
  // A batch of another folder or workspace answers 404: nothing to follow, nothing to say.
  const gone = query.error instanceof ApiError && query.error.status === 404;

  useEffect(() => {
    if (done.current) return;
    if (status === "completed" && batch) {
      done.current = true;
      toasts.applied(batch);
      onSettled(batchId);
    } else if (status === "failed") {
      done.current = true;
      toasts.failed();
      onSettled(batchId);
    } else if (gone) {
      done.current = true;
      onSettled(batchId);
    }
  }, [status, batch, gone, batchId, onSettled, toasts]);

  return null;
}
