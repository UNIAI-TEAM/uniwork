"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, FolderUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FolderUploadPlan } from "@uniwork/core/documents/folder-upload";
import { formatDocumentSizeMB } from "@uniwork/core/documents/limits";
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
import { Switch } from "@uniwork/ui/components/ui/switch";
import { formatBytes } from "../doclist/format";
import { groupSkipped, modeContext, refusalMessage, skipReasonLabel } from "./folder-upload-copy";

const MIB = 1024 * 1024;

/** A tree of a few KB must not read "0 MB": under a megabyte the size is in B / KB. */
function formatPlanSize(bytes: number, locale: string): string {
  if (bytes >= MIB) return formatDocumentSizeMB(bytes, locale);
  return bytes > 0 ? formatBytes(bytes, locale) : "0 B";
}

export interface FolderUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The plan being confirmed; null while no folder is staged. */
  plan: FolderUploadPlan | null;
  destinationName: string;
  /** True when the destination already shares with the workspace: the toggle shows that state and sends nothing. */
  parentShared?: boolean;
  /** Folders still waiting behind this one (several dropped at once). */
  queued?: number;
  /** The plan is on its way; closing (Cancel, Esc, ×) still works and means "cancel the run". */
  pending?: boolean;
  /** The server said it is busy and the run is waiting out Retry-After once. */
  waiting?: boolean;
  error?: string | null;
  onSubmit: (options: { shareWithWorkspace: boolean }) => void;
}

/**
 * The look before the upload (UNI-2052): what would go up, what is skipped and
 * why, and whether the run is refused up front. Nothing is written until
 * Upload is pressed, so cancelling the dialog changes nothing.
 */
export function FolderUploadDialog({
  open,
  onOpenChange,
  plan,
  destinationName,
  parentShared = false,
  queued = 0,
  pending = false,
  waiting = false,
  error,
  onSubmit,
}: FolderUploadDialogProps) {
  const { t, i18n } = useTranslation();
  const [share, setShare] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const shareHintId = useId();
  const popupRef = useRef<HTMLDivElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);

  // Each staged folder starts from the safe defaults: private, lists collapsed.
  useEffect(() => {
    setShare(false);
    setExpanded(new Set());
  }, [plan]);

  const refusal = plan?.refusal ?? null;
  // A plan with no root is a files-mode run (ADDENDUM 2): the files land in the destination itself.
  const mode = plan !== null && plan.rootName === null ? "files" : "folder";
  const ctx = modeContext(mode);
  const renamed = mode === "folder" && plan !== null && plan.rootTitle !== plan.rootName;
  const groups = plan ? groupSkipped(plan.skipped) : [];
  const effectiveShare = parentShared || share;
  const hintText = parentShared
    ? t("documents.folder_upload.dialog.share_inherited")
    : t("documents.folder_upload.dialog.share_hint", ctx);

  const toggleGroup = (reason: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupRef}
        // Start on the primary action; a refused plan has none, so the dialog itself takes the focus.
        initialFocus={() => (refusal || pending ? popupRef.current : submitRef.current) ?? true}
        className="sm:max-w-lg"
        closeLabel={t("common.close")} data-testid="folder-upload-dialog" data-mode={mode}>
        <DialogHeader>
          <DialogTitle>{t("documents.folder_upload.dialog.title", ctx)}</DialogTitle>
          <DialogDescription>{t("documents.folder_upload.dialog.description")}</DialogDescription>
        </DialogHeader>
        {plan ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (refusal || pending) return;
              onSubmit({ shareWithWorkspace: !parentShared && share });
            }}
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
              {mode === "folder" ? (
                <>
                  <dt className="text-muted-foreground">{t("documents.folder_upload.dialog.root_label")}</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 font-medium text-foreground" data-testid="folder-upload-root">
                    <FolderUp aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{plan.rootTitle}</span>
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{t("documents.folder_upload.dialog.destination_label")}</dt>
              <dd className="truncate text-foreground" data-testid="folder-upload-destination">
                {destinationName}
              </dd>
            </dl>
            {renamed ? (
              <p className="text-caption text-muted-foreground" data-testid="folder-upload-renamed">
                {t("documents.folder_upload.dialog.root_renamed", { name: plan.rootName, title: plan.rootTitle })}
              </p>
            ) : null}
            {refusal ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
                data-testid="folder-upload-refusal"
              >
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <p className="text-body font-medium">{t("documents.folder_upload.dialog.refusal_title", ctx)}</p>
                  <p className="text-caption">{refusalMessage(t, refusal, i18n.language, { mode })}</p>
                </div>
              </div>
            ) : (
              <p className="text-body text-foreground" data-testid="folder-upload-summary">
                {t("documents.folder_upload.dialog.summary", {
                  count: plan.totals.files,
                  size: formatPlanSize(plan.totals.bytes, i18n.language),
                })}
              </p>
            )}
            {plan.skipped.length > 0 ? (
              <section aria-label={t("documents.folder_upload.dialog.skipped_title", { count: plan.skipped.length })} className="flex flex-col gap-1.5">
                <h3 className="text-caption font-medium text-foreground">
                  {t("documents.folder_upload.dialog.skipped_title", { count: plan.skipped.length })}
                </h3>
                <ul className="flex flex-col gap-1">
                  {groups.map((group) => {
                    const open = expanded.has(group.reason);
                    const listId = `${shareHintId}-skip-${group.reason}`;
                    return (
                      <li key={group.reason} className="flex flex-col gap-1 text-caption text-muted-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {t("documents.folder_upload.dialog.skipped_reason_count", {
                              reason: skipReasonLabel(t, group.reason),
                              count: group.paths.length,
                            })}
                          </span>
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={listId}
                            className="rounded-sm text-primary underline-offset-2 hover:underline pointer-coarse:min-h-11"
                            onClick={() => toggleGroup(group.reason)}
                          >
                            {open ? t("documents.folder_upload.dialog.skipped_hide") : t("documents.folder_upload.dialog.skipped_show")}
                          </button>
                        </div>
                        {open ? (
                          <ul id={listId} className="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono">
                            {group.paths.map((path) => (
                              <li key={path} className="truncate" title={path}>
                                {path}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {!refusal ? (
              <div className="flex flex-col gap-1">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="text-body text-foreground">{t("documents.folder_upload.dialog.share_toggle")}</span>
                  <Switch
                    size="sm"
                    checked={effectiveShare}
                    aria-disabled={parentShared || pending || undefined}
                    aria-describedby={shareHintId}
                    onCheckedChange={(next) => {
                      if (parentShared || pending) return;
                      setShare(next);
                    }}
                    className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  />
                </label>
                <p id={shareHintId} className="text-caption text-muted-foreground">
                  {hintText}
                </p>
              </div>
            ) : null}
            {queued > 0 ? (
              <p className="text-caption text-muted-foreground">{t("documents.folder_upload.dialog.queue_more", { count: queued })}</p>
            ) : null}
            {waiting && !error ? (
              <p role="status" className="text-caption text-muted-foreground">
                {t("documents.folder_upload.dialog.waiting")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-caption text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter className="px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("documents.folder_upload.dialog.cancel")}
              </Button>
              <Button ref={submitRef} type="submit" aria-disabled={refusal !== null || pending || undefined} aria-busy={pending || undefined}>
                {pending ? (
                  <>
                    <Spinner aria-hidden role="presentation" />
                    {t("documents.folder_upload.dialog.submitting")}
                  </>
                ) : (
                  t("documents.folder_upload.dialog.submit")
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
