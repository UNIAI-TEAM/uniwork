"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FilePlus, Paperclip } from "lucide-react";
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
import { Progress, ProgressLabel } from "@uniwork/ui/components/ui/progress";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import type { CreateShareOptions } from "./documents-create";

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
  /** True when the open folder already shares with the home workspace. */
  parentShared?: boolean;
  /** False when staging a new version of an existing document. */
  showShareToggle?: boolean;
  onSubmit: (file: File, options?: CreateShareOptions) => void;
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
  parentShared = false,
  showShareToggle = true,
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
  const [shareWithWorkspace, setShareWithWorkspace] = useState(false);
  const shareHintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const effectiveShare = parentShared || shareWithWorkspace;
  const sendShare = showShareToggle && effectiveShare && !parentShared;
  const shareHintText = !showShareToggle
    ? null
    : parentShared
      ? t("documents.home.create.share_workspace_inherited")
      : effectiveShare
        ? t("documents.home.create.share_workspace_hint", {
            level: t("documents.home.create.share_workspace_level_view"),
          })
        : null;

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

  const submitRef = useRef<HTMLButtonElement | null>(null);
  // A chunked refusal lands after the progress block unmounts and the submit
  // button remounts: the node that had focus is gone, so put it back on
  // Upload — the same place a refusal found up front leaves the user (L-2).
  useEffect(() => {
    if (open && error && !isBusy) submitRef.current?.focus();
  }, [open, error, isBusy]);

  useEffect(() => {
    setShareWithWorkspace(false);
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
            if (sendShare) {
              onSubmit(file, { shareWithWorkspace: true });
            } else {
              onSubmit(file);
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <input
              key={inputKey}
              ref={inputRef}
              type="file"
              accept={accept}
              aria-label={t("documents.upload.pick")}
              className="sr-only"
              tabIndex={-1}
              disabled={isBusy}
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                onPickFile?.(picked);
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => inputRef.current?.click()}
              >
                <FilePlus aria-hidden className="size-3.5" />
                {t("documents.upload.pick")}
              </Button>
              <p
                className="truncate text-caption text-muted-foreground"
                data-testid="document-upload-selected"
              >
                {file ? t("documents.upload.selected", { name: file.name }) : t("documents.upload.no_file")}
              </p>
            </div>
            {!file && hint ? (
              <p className="text-caption text-muted-foreground">{hint}</p>
            ) : null}
            {showResumeHint ? (
              <p className="text-caption text-muted-foreground" data-testid="document-upload-resume-hint">
                {t("documents.upload.resume_hint")}
              </p>
            ) : null}
          </div>
          {showShareToggle ? (
            <div className="flex flex-col gap-1">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-body text-foreground">
                  {t("documents.home.create.share_workspace_toggle")}
                </span>
                <Switch
                  size="sm"
                  checked={effectiveShare}
                  aria-disabled={parentShared || isBusy || undefined}
                  aria-describedby={shareHintText ? shareHintId : undefined}
                  onCheckedChange={(next) => {
                    if (parentShared || isBusy) return;
                    setShareWithWorkspace(next);
                  }}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                />
              </label>
              {shareHintText ? (
                <p id={shareHintId} className="text-caption text-muted-foreground">
                  {shareHintText}
                </p>
              ) : null}
            </div>
          ) : null}
          {isChunkedActive ? (
            <div className="flex flex-col gap-1.5" data-testid="document-upload-progress">
              <Progress
                value={percentage}
                className={cn(
                  "*:data-[slot=progress-track]:bg-border *:data-[slot=progress-track]:ring-1 *:data-[slot=progress-track]:ring-input",
                  percentage >= 100 && "*:data-[slot=progress-indicator]:transition-none",
                )}
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
              <Button
                ref={submitRef}
                type="submit"
                disabled={!file || pending}
                aria-busy={pending || undefined}
              >
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
