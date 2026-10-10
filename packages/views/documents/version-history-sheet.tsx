"use client";

import { lazy, Suspense, useRef, useState } from "react";
import { Download, Eye, RotateCcwClock, RotateCcw, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { useDocumentDownload } from "@uniwork/core/documents/hooks";
import {
  useCreateDocumentVersion,
  useDocumentVersions,
  useRestoreDocumentVersion,
} from "@uniwork/core/documents/hooks-versions";
import type { Document, DocumentVersion } from "@uniwork/core/types/document";
import { createSafeId } from "@uniwork/core/utils";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { formatFileSize, formatWhen } from "./document-format";

// The editor chunk only arrives when a page version is actually previewed, so
// opening the sheet never drags TipTap into the route's first load.
const VersionPreviewDialog = lazy(() =>
  import("./version-preview-dialog").then((mod) => ({ default: mod.VersionPreviewDialog })),
);

export interface VersionHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  /** The live document; its level and revision decide what the sheet may do. */
  doc: Document;
}

/** The version reason is a schema identifier; only its label is translated. */
const REASON_KEY: Record<string, string> = {
  upload: "reason_upload",
  manual: "reason_manual",
  auto: "reason_auto",
  restore: "reason_restore",
  agent: "reason_agent",
};

function reasonLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  version: DocumentVersion,
): string {
  const key = REASON_KEY[version.reason];
  return key ? t(`documents.file.${key}`) : t("documents.file.unknown_reason");
}

/**
 * `documents.detail` version drawer (C-01 §5.2; G1-08, UNI-682).
 *
 * The history is the server's: rows come from the paginated versions query and
 * every write is confirmed before it lands. Restoring never switches the
 * working copy locally — the confirm dialog stays pending until the server
 * answers, and only the mutation's own answer moves the document cache.
 */
export function VersionHistorySheet({ open, onOpenChange, wsId, doc }: VersionHistorySheetProps) {
  const { t, i18n } = useTranslation();
  const canEdit = doc.my_level === "edit" || doc.my_level === "manage";
  const versions = useDocumentVersions(wsId, doc.id, { enabled: open });
  const create = useCreateDocumentVersion(wsId, doc.id);
  const restore = useRestoreDocumentVersion(wsId, doc.id);
  const download = useDocumentDownload(wsId, doc.id);

  const [label, setLabel] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const createKeyRef = useRef<string | null>(null);
  const [previewNo, setPreviewNo] = useState<number | undefined>(undefined);
  const [restoreTarget, setRestoreTarget] = useState<DocumentVersion | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreKeyRef = useRef<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);

  const rows = versions.data?.pages.flatMap((page) => page.versions) ?? [];

  const changeLabel = (next: string) => {
    setLabel(next);
    // A changed name is a new checkpoint intent: the next submit mints a key.
    createKeyRef.current = null;
    setCreateError(null);
  };

  const submitName = async () => {
    if (create.isPending || !canEdit) return;
    setCreateError(null);
    createKeyRef.current ??= createSafeId();
    try {
      const version = await create.mutateAsync({
        label: label.trim() || undefined,
        idempotencyKey: createKeyRef.current,
      });
      createKeyRef.current = null;
      setLabel("");
      toast.success(t("documents.versions.name_done", { no: version.version }));
    } catch (err) {
      setCreateError(apiErrorMessage(err) ?? t("documents.versions.name_failed"));
    }
  };

  /**
   * Confirm restore. The dialog only closes on a verifiable answer; a failure
   * keeps the target and the message in place. The working copy is untouched
   * until then, and a conflict clears the key so the retry starts a new intent
   * on the fresh base rather than replaying the rejected payload.
   */
  const confirmRestore = async () => {
    if (!restoreTarget || restore.isPending) return;
    setRestoreError(null);
    restoreKeyRef.current ??= createSafeId();
    try {
      await restore.mutateAsync({
        versionNo: restoreTarget.version,
        idempotencyKey: restoreKeyRef.current,
        // File restores name the base they intend to overwrite; page restores
        // replace the working copy and the server owns the revision.
        baseRevision: doc.kind === "file" ? doc.revision : undefined,
      });
      restoreKeyRef.current = null;
      setRestoreTarget(null);
    } catch (err) {
      const cls = classifyDocumentError(err).cls;
      if (cls === "conflict") {
        restoreKeyRef.current = null;
        setRestoreError(t("documents.versions.restore_conflict"));
      } else {
        setRestoreError(apiErrorMessage(err) ?? t("documents.versions.restore_failed"));
      }
    }
  };

  const downloadVersion = async (version: DocumentVersion) => {
    setDownloading(version.version);
    try {
      const blob = await download.mutateAsync({ version: version.version });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = doc.file?.filename ?? doc.title;
      anchor.rel = "noopener";
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      toast.error(t("documents.file.download_failed"));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md" closeLabel={t("common.close")}>
        <SheetHeader>
          <SheetTitle>{t("documents.versions.title")}</SheetTitle>
          <SheetDescription>{t("documents.versions.description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {canEdit ? (
            <form
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitName();
              }}
            >
              <Label htmlFor="document-version-label">{t("documents.versions.name_label")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="document-version-label"
                  value={label}
                  maxLength={200}
                  placeholder={t("documents.versions.name_placeholder")}
                  disabled={create.isPending}
                  onChange={(event) => changeLabel(event.target.value)}
                />
                <Button type="submit" size="sm" disabled={create.isPending} aria-busy={create.isPending || undefined}>
                  {create.isPending ? (
                    <>
                      <Spinner aria-hidden role="presentation" />
                      {t("documents.versions.name_submitting")}
                    </>
                  ) : (
                    <>
                      <Tag aria-hidden className="size-3.5" />
                      {t("documents.versions.name_submit")}
                    </>
                  )}
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">{t("documents.versions.name_hint")}</p>
              {createError ? (
                <p role="alert" className="text-caption text-destructive">
                  {createError}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground">
              {t("documents.versions.manage_only")}
            </p>
          )}

          {versions.isPending ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-2/3" />
            </div>
          ) : versions.isError ? (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border p-3">
              <p role="alert" className="text-caption text-destructive">
                {t("documents.versions.error")}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void versions.refetch()}>
                {t("documents.versions.retry")}
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="mt-3 px-1 text-caption text-muted-foreground">
              {t("documents.versions.empty")}
            </p>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                {rows.map((version) => (
                  <li key={version.id} className="flex items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-body text-foreground">
                        <span className="font-medium">
                          {t("documents.versions.row_version", { no: version.version })}
                        </span>
                        {version.version === doc.current_version ? (
                          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                            {t("documents.versions.current_badge")}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-caption text-muted-foreground">
                        {version.label ? <span className="text-foreground">{version.label} · </span> : null}
                        {reasonLabel(t, version)}
                        {version.size_bytes > 0 ? ` · ${formatFileSize(version.size_bytes, i18n.language)}` : ""}
                        {version.created_at ? ` · ${formatWhen(version.created_at, i18n.language)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {doc.kind === "page" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("documents.versions.view")}
                          onClick={() => setPreviewNo(version.version)}
                        >
                          <Eye aria-hidden className="size-3.5" />
                        </Button>
                      ) : null}
                      {doc.kind === "file" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("documents.file.download_version", { no: version.version })}
                          disabled={downloading !== null}
                          aria-busy={downloading === version.version || undefined}
                          onClick={() => void downloadVersion(version)}
                        >
                          <Download aria-hidden className="size-3.5" />
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("documents.versions.restore", { no: version.version })}
                          onClick={() => {
                            setRestoreError(null);
                            restoreKeyRef.current = null;
                            setRestoreTarget(version);
                          }}
                        >
                          <RotateCcw aria-hidden className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {versions.hasNextPage ? (
                <div className="mt-3 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={versions.isFetchingNextPage}
                    aria-busy={versions.isFetchingNextPage || undefined}
                    onClick={() => void versions.fetchNextPage()}
                  >
                    {versions.isFetchingNextPage ? (
                      <Spinner aria-hidden role="presentation" />
                    ) : (
                      <RotateCcwClock aria-hidden className="size-3.5" />
                    )}
                    {t("documents.versions.load_more")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {open && previewNo !== undefined ? (
          <Suspense fallback={null}>
            <VersionPreviewDialog
              open
              onOpenChange={(next) => {
                if (!next) setPreviewNo(undefined);
              }}
              wsId={wsId}
              doc={doc}
              versionNo={previewNo}
            />
          </Suspense>
        ) : null}

        <AlertDialog
          open={restoreTarget !== null}
          onOpenChange={(next) => {
            if (!next && !restore.isPending) {
              setRestoreTarget(null);
              setRestoreError(null);
              restoreKeyRef.current = null;
            }
          }}
        >
          <AlertDialogContent nested>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("documents.versions.restore_confirm_title", { no: restoreTarget?.version ?? 0 })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("documents.versions.restore_confirm_description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {restoreError ? (
              <p role="alert" className="text-caption text-destructive">
                {restoreError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={restore.isPending}>
                {t("common.cancel")}
              </AlertDialogCancel>
              <Button
                type="button"
                disabled={restore.isPending}
                aria-busy={restore.isPending || undefined}
                onClick={() => void confirmRestore()}
              >
                {restore.isPending ? (
                  <>
                    <Spinner aria-hidden role="presentation" />
                    {t("documents.versions.restore_submitting")}
                  </>
                ) : (
                  t("documents.versions.restore_confirm_submit")
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
