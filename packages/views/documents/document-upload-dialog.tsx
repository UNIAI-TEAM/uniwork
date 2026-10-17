"use client";

import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChunkedUploadProgress } from "@uniwork/core/documents/chunked-upload";
import { DOCUMENT_UPLOAD_ACCEPT } from "@uniwork/core/documents/limits";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Progress, ProgressLabel } from "@uniwork/ui/components/ui/progress";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

export interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Repeatable-format allowlist, passed straight to the file input. */
  accept?: string;
  hint?: string;
  pending?: boolean;
  /** A failed attempt, shown in place so the picked file is not lost. */
  error?: string | null;
  onSubmit: (file: File) => void;
  /** Progress state when a large file uses the chunked upload engine. */
  chunkedProgress?: ChunkedUploadProgress | null;
  onPause?: () => void;
  onResume?: () => void;
  onCancelUpload?: (file: File | null) => void;
  hasResumable?: (file: File) => boolean;
  onPickFile?: (file: File | null) => void;
}

/**
 * One picker for both upload shapes: a new file document and a new version of
 * an existing one. The bytes only leave the browser on submit — picking a
 * file is not a write, so a cancelled dialog changes nothing.
 */
export function DocumentUploadDialog({
  open,
  onOpenChange,
  title,
  description,
  accept = DOCUMENT_UPLOAD_ACCEPT,
  hint,
  pending = false,
  error,
  onSubmit,
  chunkedProgress = null,
  onPause,
  onResume,
  onCancelUpload,
  hasResumable,
  onPickFile,
}: DocumentUploadDialogProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const phase = chunkedProgress?.phase ?? null;
  const isUploading = phase === "probing" || phase === "opening" || phase === "uploading";
  const isPaused = phase === "paused";
  const isVerifying = phase === "verifying";
  const isChunkedActive = isUploading || isPaused || isVerifying;
  const isBusy = pending || isChunkedActive;
  const percentage =
    chunkedProgress !== null
      ? chunkedProgress.totalBytes > 0
        ? Math.min(100, Math.floor((chunkedProgress.sentBytes / chunkedProgress.totalBytes) * 100))
        : 0
      : 0;
  const showResumeHint = Boolean(file && !isChunkedActive && hasResumable?.(file));

  useEffect(() => {
    if (!open) {
      setFile(null);
      // Remount the input so picking the same file again still fires a change.
      setInputKey((key) => key + 1);
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (isUploading && onPause) {
            onPause();
            return;
          }
          if (pending || isVerifying) return;
          if (isPaused && onCancelUpload) {
            onCancelUpload(file);
          }
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!pending && !isUploading && !isVerifying}
        closeLabel={t("common.close")}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file || isBusy) return;
            onSubmit(file);
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-upload-file">{t("documents.upload.pick")}</Label>
            <Input
              key={inputKey}
              id="document-upload-file"
              type="file"
              accept={accept}
              disabled={isBusy}
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                onPickFile?.(picked);
              }}
            />
            {file ? (
              <p className="text-caption text-muted-foreground" data-testid="document-upload-selected">
                {t("documents.upload.selected", { name: file.name })}
              </p>
            ) : hint ? (
              <p className="text-caption text-muted-foreground">{hint}</p>
            ) : null}
            {showResumeHint ? (
              <p className="text-caption text-muted-foreground" data-testid="document-upload-resume-hint">
                {t("documents.upload.resume_hint")}
              </p>
            ) : null}
          </div>
          {isChunkedActive ? (
            <div className="flex flex-col gap-1.5" data-testid="document-upload-progress">
              <Progress
                value={percentage}
                aria-label={t("documents.upload.progress_status", { name: file?.name ?? "" })}
              >
                <ProgressLabel className="truncate text-caption">{file?.name}</ProgressLabel>
                <span className="ml-auto text-caption text-muted-foreground tabular-nums">
                  {`${percentage}%`}
                </span>
              </Progress>
              <p
                className="min-h-4 text-caption text-muted-foreground"
                data-testid="document-upload-status"
              >
                {isPaused ? t("documents.upload.paused_status") : null}
              </p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="px-0 pb-0">
            <Button
              type="button"
              variant="outline"
              disabled={pending || isVerifying}
              onClick={() => {
                if (isChunkedActive && onCancelUpload) {
                  onCancelUpload(file);
                  return;
                }
                onOpenChange(false);
              }}
            >
              {t("documents.upload.cancel")}
            </Button>
            {isUploading ? (
              <Button type="button" variant="outline" onClick={onPause}>
                {t("documents.upload.pause")}
              </Button>
            ) : isPaused ? (
              <Button type="button" onClick={onResume}>
                {t("documents.upload.resume")}
              </Button>
            ) : isVerifying ? (
              <Button type="button" disabled aria-busy>
                <Spinner aria-hidden role="presentation" />
                {t("documents.upload.checking")}
              </Button>
            ) : (
              <Button type="submit" disabled={!file || pending} aria-busy={pending || undefined}>
                {pending ? (
                  <>
                    <Spinner aria-hidden role="presentation" />
                    {t("documents.upload.submitting")}
                  </>
                ) : (
                  <>
                    <Paperclip aria-hidden className="size-3.5" />
                    {t("documents.upload.submit")}
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
