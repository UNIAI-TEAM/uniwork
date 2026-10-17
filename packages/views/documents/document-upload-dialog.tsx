"use client";

import { useEffect, useId, useState } from "react";
import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Switch } from "@uniwork/ui/components/ui/switch";
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
}: DocumentUploadDialogProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [shareWithWorkspace, setShareWithWorkspace] = useState(false);
  const shareHintId = useId();
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

  useEffect(() => {
    setShareWithWorkspace(false);
    if (!open) {
      setFile(null);
      // Remount the input so picking the same file again still fires a change.
      setInputKey((key) => key + 1);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending} closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!file || pending) return;
            if (sendShare) {
              onSubmit(file, { shareWithWorkspace: true });
            } else {
              onSubmit(file);
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-upload-file">{t("documents.upload.pick")}</Label>
            <Input
              key={inputKey}
              id="document-upload-file"
              type="file"
              accept={accept}
              disabled={pending}
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
              }}
            />
            {file ? (
              <p className="text-caption text-muted-foreground" data-testid="document-upload-selected">
                {t("documents.upload.selected", { name: file.name })}
              </p>
            ) : hint ? (
              <p className="text-caption text-muted-foreground">{hint}</p>
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
                  aria-disabled={parentShared || pending || undefined}
                  aria-describedby={shareHintText ? shareHintId : undefined}
                  onCheckedChange={(next) => {
                    if (parentShared || pending) return;
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
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="px-0 pb-0">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("documents.upload.cancel")}
            </Button>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
