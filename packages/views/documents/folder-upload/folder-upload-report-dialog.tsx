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
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { failureReasonMessage } from "./folder-upload-copy";

export interface FolderUploadFailure {
  path: string;
  code?: string;
}

export interface FolderUploadReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The folder's real title, as the server answered. */
  name: string;
  failures: readonly FolderUploadFailure[];
  retrying?: boolean;
  onRetry: () => void;
}

/** The files that did not go up, each with its reason, and the one action that retries only them. */
export function FolderUploadReportDialog({ open, onOpenChange, name, failures, retrying = false, onRetry }: FolderUploadReportDialogProps) {
  const { t } = useTranslation();
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
          {failures.map((failure) => (
            <li key={failure.path} className="flex flex-col gap-0.5">
              <span className="truncate font-mono text-caption text-foreground" title={failure.path}>
                {failure.path}
              </span>
              <span className="text-caption text-muted-foreground">{failureReasonMessage(t, failure.code)}</span>
            </li>
          ))}
        </ul>
        <DialogFooter className="px-0 pb-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("documents.folder_upload.report.close")}
          </Button>
          <Button
            type="button"
            aria-disabled={failures.length === 0 || retrying || undefined}
            aria-busy={retrying || undefined}
            onClick={() => {
              if (failures.length === 0 || retrying) return;
              onRetry();
            }}
          >
            {retrying ? (
              <>
                <Spinner aria-hidden role="presentation" />
                {t("documents.folder_upload.report.retrying")}
              </>
            ) : (
              t("documents.folder_upload.report.retry")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
