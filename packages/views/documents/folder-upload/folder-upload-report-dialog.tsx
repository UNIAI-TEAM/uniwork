"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { failureReasonMessage, failureSentenceHasHint, modeContext, type FolderUploadMode } from "./folder-upload-copy";

export interface FolderUploadFailure {
  path: string;
  code?: string;
  /** The server's detail beside `unsupported_media` (e.g. `zip_unreadable`). */
  reason?: string;
  /** False when the server failed the file for good: it has to be fixed and the folder uploaded again. */
  retryable?: boolean;
}

export interface FolderUploadReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The folder's real title, as the server answered. */
  name: string;
  failures: readonly FolderUploadFailure[];
  /** Whether "Thử lại các tệp lỗi" can do anything: a retryable failure in a batch still open. */
  canRetry?: boolean;
  /** 410: the batch is gone, so nothing can be retried and the folder has to be uploaded again. */
  expired?: boolean;
  onRetry: () => void;
  /** Files mode (ADDENDUM 2): every "upload the folder again" reads "upload the files again". */
  mode?: FolderUploadMode;
}

/** The files that did not go up, each with its reason, and the one action that retries only them. */
export function FolderUploadReportDialog({ open, onOpenChange, name, failures, canRetry = true, expired = false, onRetry, mode = "folder" }: FolderUploadReportDialogProps) {
  const { t } = useTranslation();
  const ctx = modeContext(mode);
  // One place for "fix it and upload again": a final failure's own sentence when it says so, else one hint under the list.
  const finalHint =
    !expired &&
    failures.some(
      (failure) => (!canRetry || failure.retryable === false) && !failureSentenceHasHint(failure.code, failure.reason),
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("documents.folder_upload.report.title")}</DialogTitle>
          <DialogDescription>{t("documents.folder_upload.report.description", { name, count: failures.length })}</DialogDescription>
        </DialogHeader>
        <ul
          aria-label={t("documents.folder_upload.report.list_label")}
          className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border border-border p-2"
        >
          {failures.map((failure, index) => (
            // Files mode keeps same-named files (FD-D10): the path alone is not a key.
            <li key={`${index}:${failure.path}`} className="flex flex-col gap-0.5">
              <span className="truncate font-mono text-caption text-foreground" title={failure.path}>
                {failure.path}
              </span>
              <span className="text-caption text-muted-foreground">{failureReasonMessage(t, failure.code, failure.reason, mode)}</span>
            </li>
          ))}
        </ul>
        {expired ? (
          <p className="text-caption text-muted-foreground">{t("documents.folder_upload.report.expired_note", ctx)}</p>
        ) : null}
        {finalHint ? <p className="text-caption text-muted-foreground">{t("documents.folder_upload.report.final_hint", ctx)}</p> : null}
        <DialogFooter className="px-0 pb-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("documents.folder_upload.report.close")}
          </Button>
          {canRetry && !expired ? (
            <Button
              type="button"
              aria-disabled={failures.length === 0 || undefined}
              onClick={() => {
                if (failures.length === 0) return;
                onRetry();
              }}
            >
              {t("documents.folder_upload.report.retry")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
