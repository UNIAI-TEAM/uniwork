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
  const retryNow = canRetry && !expired;
  // One place for the advice once retrying cannot help: a final failure's own sentence when it says what to do,
  // else one hint under the list ("fix the file" when a failure is final, "upload again" when only the retry is gone).
  const unadvised = expired
    ? []
    : failures.filter(
        (failure) => (!retryNow || failure.retryable === false) && !failureSentenceHasHint(failure.code, failure.reason),
      );
  const footerHint =
    unadvised.length === 0
      ? null
      : unadvised.some((failure) => failure.retryable === false)
        ? "documents.folder_upload.report.final_hint"
        : "documents.folder_upload.report.reupload_hint";
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
          {failures.map((failure, index) => {
            // The name leads: a long root folder would otherwise truncate every row to the same prefix.
            const slash = failure.path.lastIndexOf("/");
            const folder = slash < 0 ? "" : failure.path.slice(0, slash);
            return (
              // Files mode keeps same-named files (FD-D10): the path alone is not a key.
              <li key={`${index}:${failure.path}`} className="flex min-w-0 flex-col gap-0.5" title={failure.path}>
                <span className="truncate font-mono text-caption text-foreground">{failure.path.slice(slash + 1)}</span>
                {folder ? <span className="truncate font-mono text-caption text-muted-foreground">{folder}</span> : null}
                <span className="text-caption text-muted-foreground">{failureReasonMessage(t, failure.code, failure.reason, mode, retryNow, failure.retryable !== false)}</span>
              </li>
            );
          })}
        </ul>
        {expired ? (
          <p className="text-caption text-muted-foreground">{t("documents.folder_upload.report.expired_note", ctx)}</p>
        ) : null}
        {footerHint ? <p className="text-caption text-muted-foreground">{t(footerHint, ctx)}</p> : null}
        <DialogFooter className="px-0 pb-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("documents.folder_upload.report.close")}
          </Button>
          {retryNow ? (
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
