"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, FolderUp, MonitorUp } from "lucide-react";
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
import type { OfficeHomeLaunchProps } from "../../office/office-home-launch";
import { useOfficeHomeLaunch } from "../../office/use-office-home-launch";
import { formatBytes } from "../doclist/format";
import { groupSkipped, modeContext, refusalMessage, skipReasonLabel } from "./folder-upload-copy";
import { FolderUploadUnreadableList, FolderUploadUnreadableSuggestion } from "./folder-upload-unreadable";

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
  /** Planned paths (root first) of the files the browser cannot read; any turns the dialog into the warning. */
  unreadable?: readonly string[];
  /** The probe for them is still running. */
  checking?: boolean;
  /** Host wiring of "Open UniWork Office"; without it (or on a device with no app) the warning suggests a shorter path. */
  officeHome?: OfficeHomeLaunchProps;
  /**
   * "Mở UniWork Office" was pressed and the link sent, whatever the browser could tell of it: the folder is the
   * app's to upload now and nothing was written here. The host closes this dialog and toasts; `install` opens the
   * installer dialog on its own when the server has an installer for this channel, and is null when it has none.
   */
  onHandoff?: (install: (() => void) | null) => void;
  /** The staged pick this dialog shows; a launch answers only to the pick it began for, never to the next one. */
  pick?: object | null;
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
  unreadable = [],
  checking = false,
  officeHome,
  onHandoff,
  pick,
  onSubmit,
}: FolderUploadDialogProps) {
  const { t, i18n } = useTranslation();
  const [share, setShare] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [showAllUnreadable, setShowAllUnreadable] = useState(false);
  const shareHintId = useId();
  const popupRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  // Each staged folder starts from the safe defaults: private, lists collapsed.
  useEffect(() => {
    setShare(false);
    setExpanded(new Set());
    setShowAllUnreadable(false);
  }, [plan]);

  const refusal = plan?.refusal ?? null;
  // Files the browser cannot read (UNI-2152): the dialog is the warning, with the app as its way out.
  const warn = unreadable.length > 0 && refusal === null;
  const launcher = useOfficeHomeLaunch(officeHome, { onHandoff: (install) => onHandoff?.(install), scope: pick });
  const appAvailable = launcher.status !== "unavailable";
  const left = plan ? Math.max(0, plan.totals.files - unreadable.length) : 0;
  // The dialog turned into the warning (a slow probe answered) or the device has no app to open: the focus follows
  // to the primary action, which the footer just swapped. The first open is initialFocus's.
  useEffect(() => {
    if (warn) primaryRef.current?.focus();
  }, [warn, appAvailable]);
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupRef}
        // Start on the primary action; a refused plan has none, so the dialog itself takes the focus.
        initialFocus={() => (refusal || pending ? popupRef.current : primaryRef.current) ?? true}
        // One shrinkable column: a long folder name wraps or truncates inside it and never widens the dialog past its edges.
        className="grid-cols-[minmax(0,1fr)] sm:max-w-lg"
        closeLabel={t("common.close")} data-testid="folder-upload-dialog" data-mode={mode}>
        <DialogHeader>
          <DialogTitle>
            {warn
              ? t("documents.folder_upload.unreadable.title", { count: unreadable.length })
              : t("documents.folder_upload.dialog.title", ctx)}
          </DialogTitle>
          <DialogDescription>
            {warn
              ? t(`documents.folder_upload.unreadable.${unreadable.length === 1 ? "why_single" : "why_multiple"}`)
              : t("documents.folder_upload.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        {plan ? (
          <form
            className="flex min-w-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (refusal || pending || checking || launcher.launching || (warn && left === 0)) return;
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
              <p className="min-w-0 break-words text-caption text-muted-foreground" data-testid="folder-upload-renamed">
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
            {checking ? (
              <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
                <Spinner aria-hidden role="presentation" />
                {t("documents.folder_upload.unreadable.checking", ctx)}
              </p>
            ) : null}
            {warn ? (
              <>
                <FolderUploadUnreadableList
                  paths={unreadable}
                  mode={mode}
                  showAll={showAllUnreadable}
                  onToggle={() => setShowAllUnreadable((value) => !value)}
                  listId={`${shareHintId}-unreadable`}
                />
                <FolderUploadUnreadableSuggestion mode={mode} appAvailable={appAvailable} />
              </>
            ) : null}
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
            {/* -mx-4 / -mb-4: the band runs to the dialog's edges, past the content padding. */}
            <DialogFooter className="-mx-4 -mb-4">
              <Button type="button" variant={warn ? "ghost" : "outline"} onClick={() => onOpenChange(false)}>
                {t("documents.folder_upload.dialog.cancel")}
              </Button>
              {warn ? (
                <>
                  {left > 0 ? (
                    <Button
                      ref={appAvailable ? undefined : primaryRef}
                      type="submit"
                      variant={appAvailable ? "outline" : "default"}
                      aria-disabled={pending || launcher.launching || undefined}
                      aria-busy={pending || undefined}
                    >
                      {pending ? (
                        <>
                          <Spinner aria-hidden role="presentation" />
                          {t("documents.folder_upload.dialog.submitting")}
                        </>
                      ) : (
                        t("documents.folder_upload.unreadable.rest", { count: left })
                      )}
                    </Button>
                  ) : null}
                  {appAvailable ? (
                    <Button
                      ref={primaryRef}
                      type="button"
                      aria-disabled={pending || launcher.launching || undefined}
                      aria-busy={launcher.launching || undefined}
                      onClick={() => void launcher.run()}
                    >
                      {launcher.launching ? (
                        <>
                          <Spinner aria-hidden role="presentation" />
                          {t("documents.folder_upload.unreadable.opening")}
                        </>
                      ) : (
                        <>
                          <MonitorUp aria-hidden />
                          {t("documents.home.open_office")}
                        </>
                      )}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  ref={primaryRef}
                  type="submit"
                  aria-disabled={refusal !== null || pending || checking || undefined}
                  aria-busy={pending || undefined}
                >
                  {pending ? (
                    <>
                      <Spinner aria-hidden role="presentation" />
                      {t("documents.folder_upload.dialog.submitting")}
                    </>
                  ) : (
                    t("documents.folder_upload.dialog.submit")
                  )}
                </Button>
              )}
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
    {/* Beside the warning, never inside it: the toast opens it after the warning has closed. */}
    {launcher.prompt}
    </>
  );
}
