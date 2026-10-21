"use client";

import { useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { isDownloadTooLargeError } from "@uniwork/core/api/endpoints/documents-download-jobs";
import type { BulkFailure } from "@uniwork/core/documents/bulk";
import { isAbortError, useBulkDocumentCommand, useDocumentDownloadJob, type BulkDocumentCommand } from "@uniwork/core/documents/hooks-bulk";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
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
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { folderLeavesMyFolder } from "../document-tree-model";
import { FolderPickerDialog } from "../folder-picker-dialog";
import type { DocumentSummaryRow } from "../library-rows";
import { MoveOutConfirmDialog } from "../move-out-confirm-dialog";
import type { BulkActionId, BulkPlan, DocListBulk } from "./bulk-actions";
import { BulkShareDialog } from "./bulk-share-dialog";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The reasons the error list words; any other code reads "did not go through". */
const REASONS = new Set(["forbidden", "not_found", "conflict", "rate_limited", "not_verifiable", "not_a_file", "not_shareable", "too_large", "folder_too_large", "zip_limit"]);
/** One zip job holds at most this many documents (the server's `download-jobs` limit); the rest are skipped with their own reason. */
const ZIP_MAX = 100;
/** The error list shows this many lines, then "and N more". */
const LISTED = 5;

/** Each failed or skipped document by name and reason, in the order they were selected. */
function BulkErrorList({ failures, titles, t }: { failures: BulkFailure[]; titles: ReadonlyMap<string, string>; t: Translate }) {
  const order = [...titles.keys()];
  const sorted = [...failures].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const rest = sorted.length - LISTED;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {sorted.slice(0, LISTED).map((failure) => (
        <li key={failure.id}>
          {t("documents.list.bulk.error_line", {
            title: titles.get(failure.id) || t("documents.detail.untitled"),
            reason: t(`documents.list.bulk.error.${REASONS.has(failure.code) ? failure.code : "failed"}`),
          })}
        </li>
      ))}
      {rest > 0 ? <li>{t("documents.list.bulk.more", { count: rest })}</li> : null}
    </ul>
  );
}

/** Opens the signed link of a ready zip job: the browser downloads it (the URL lives one hour). */
function saveLink(url: string) {
  const link = window.document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  window.document.body.append(link);
  link.click();
  link.remove();
}

type Pending = { plan: BulkPlan; done: () => void };

/**
 * What the bulk bar's actions do (UNI-2045 W9, contract §7). Restore, unshelve
 * and shelve run at once; the trash and the purge ask once for the batch;
 * the move asks for its target once; then the batch fans out over the
 * single-document routes (core `useBulkDocumentCommand`, at most four at a
 * time, one invalidation at the end) and one toast says "Đã … 3/5 tài liệu"
 * with the documents it could not act on. Several files download as one SV-9
 * zip job, one file through the row's own download. Share opens one dialog
 * for the whole batch (W13) and fans out the same way.
 */
export function useDocListBulkCommands({
  wsId,
  tree,
  onDownloadOne,
  zipPollMs,
}: {
  wsId: string;
  /** The folder tree, for the move target picker. */
  tree: DocumentTreeNode[];
  /** The row menu's single-file download. */
  onDownloadOne: (doc: DocumentSummaryRow) => void;
  /** How often the zip job is polled; 2 s unless a test says otherwise. */
  zipPollMs?: number;
}): { bulk: DocListBulk; dialogs: ReactNode } {
  const { t } = useTranslation();
  const command = useBulkDocumentCommand(wsId);
  const zip = useDocumentDownloadJob(wsId, { pollMs: zipPollMs });
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [moving, setMoving] = useState<Pending | null>(null);
  // One confirm for the batch when a selected folder leaves My Folder (UNI-2055 W3): the picked target waits here.
  const [confirmingOut, setConfirmingOut] = useState<string | null | undefined>(undefined);
  const [sharing, setSharing] = useState<Pending | null>(null);
  // A batch or a zip in flight: the bar's buttons wait for it and a second press runs nothing.
  const busy = command.isPending || zip.isPending;
  const inFlight = useRef(false);
  const once = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await work();
    } finally {
      inFlight.current = false;
    }
  };

  const report = (plan: BulkPlan, ok: number, failures: BulkFailure[], id?: string | number) => {
    const title = t(`documents.list.bulk.done.${plan.action}`, { ok, total: plan.total });
    const description = failures.length > 0 ? <BulkErrorList failures={failures} titles={plan.titles} t={t} /> : undefined;
    (ok > 0 ? toast.success : toast.error)(title, { description, id });
  };

  const execute = ({ plan, done }: Pending, parentId: string | null = null) =>
    once(async () => {
      const result = await command.mutateAsync({ command: plan.action as BulkDocumentCommand, ids: plan.docs.map((doc) => doc.id), parentId });
      report(plan, result.ok.length, [...result.failed, ...plan.skipped]);
      done();
    });

  const download = ({ plan, done }: Pending) => once(() => zipOf(plan, done));

  const zipOf = async (plan: BulkPlan, done: () => void) => {
    if (plan.docs.length === 1) {
      onDownloadOne(plan.docs[0]!);
      if (plan.skipped.length > 0) report(plan, 1, plan.skipped);
      done();
      return;
    }
    const id = toast.loading(t("documents.list.bulk.zip.preparing"));
    // The first 100 go into the job; the rest wait for another batch and are named as skipped.
    const beyond: BulkFailure[] = plan.docs.slice(ZIP_MAX).map((doc) => ({ id: doc.id, code: "zip_limit" }));
    try {
      const job = await zip.mutateAsync(plan.docs.slice(0, ZIP_MAX).map((doc) => doc.id));
      switch (job.status) {
        case "ready": {
          if (!job.download_url) {
            toast.error(t("documents.list.bulk.zip.failed"), { id });
            break;
          }
          saveLink(job.download_url);
          const skipped = job.skipped.map((skip) => ({ id: skip.document_id, code: skip.reason }));
          report(plan, job.file_count ?? plan.docs.length - beyond.length - skipped.length, [...skipped, ...beyond, ...plan.skipped], id);
          break;
        }
        case "expired":
          toast.error(t("documents.list.bulk.zip.expired"), { id });
          break;
        case "failed":
          toast.error(t("documents.list.bulk.zip.failed"), { id });
          break;
        default:
          // Still queued or running when the poll cap ran out.
          toast.error(t("documents.list.bulk.zip.timeout"), { id });
      }
    } catch (error) {
      if (isAbortError(error)) {
        // The screen was left: nothing to say and no selection left to clear.
        toast.dismiss(id);
        return;
      }
      toast.error(isDownloadTooLargeError(error) ? t("documents.list.bulk.zip.too_large") : (apiErrorMessage(error) ?? t("documents.list.bulk.zip.failed")), { id });
    }
    done();
  };

  const run = (plan: BulkPlan, done: () => void) => {
    if (busy || inFlight.current) return;
    const pending = { plan, done };
    switch (plan.action) {
      case "trash":
      case "purge":
        setConfirming(pending);
        return;
      case "move":
        setMoving(pending);
        return;
      case "share":
        setSharing(pending);
        return;
      case "download":
        void download(pending);
        return;
      case "shelve":
      case "unshelve":
      case "restore":
        void execute(pending);
        return;
      default:
        return;
    }
  };

  const purge = confirming?.plan.action === "purge";
  const dialogs = (
    <>
      <AlertDialog open={confirming !== null} onOpenChange={(next) => (!next && !busy ? setConfirming(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(purge ? "documents.list.bulk.confirm.purge_title" : "documents.list.bulk.confirm.trash_title", { count: confirming?.plan.docs.length ?? 0 })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(purge ? "documents.list.bulk.confirm.purge_description" : "documents.list.bulk.confirm.trash_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => {
                if (!confirming || busy) return;
                void execute(confirming).finally(() => setConfirming(null));
              }}
            >
              {busy ? <Spinner aria-hidden role="presentation" /> : <Trash2 aria-hidden className="size-3.5" />}
              {t(purge ? "documents.list.bulk.confirm.purge_action" : "documents.list.bulk.confirm.trash_action")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <FolderPickerDialog
        open={moving !== null}
        onOpenChange={(next) => {
          if (!next && !busy) {
            setMoving(null);
            setConfirmingOut(undefined);
          }
        }}
        title={t("documents.list.bulk.move.title", { count: moving?.plan.docs.length ?? 0 })}
        description={t("documents.list.bulk.move.description")}
        submitLabel={t("documents.home.move.submit")}
        pickerLabel={t("documents.home.move.picker_label")}
        rootLabel={t("documents.home.move.root")}
        tree={tree}
        initialFolderId={null}
        movingIds={moving?.plan.docs.map((doc) => doc.id)}
        pending={busy}
        error={null}
        onSubmit={(target) => {
          if (!moving || busy) return;
          if (folderLeavesMyFolder(tree, moving.plan.docs.map((doc) => doc.id), target)) {
            setConfirmingOut(target);
            return;
          }
          void execute(moving, target).finally(() => setMoving(null));
        }}
      />
      <MoveOutConfirmDialog
        open={moving !== null && confirmingOut !== undefined}
        onCancel={() => setConfirmingOut(undefined)}
        onConfirm={() => {
          const target = confirmingOut;
          setConfirmingOut(undefined);
          if (!moving || busy || target === undefined) return;
          void execute(moving, target).finally(() => setMoving(null));
        }}
      />
      <BulkShareDialog
        wsId={wsId}
        plan={sharing?.plan ?? null}
        onOpenChange={(next) => {
          if (!next) setSharing(null);
        }}
        onApplied={(result) => {
          if (!sharing) return;
          report(sharing.plan, result.ok.length, [...result.failed, ...sharing.plan.skipped]);
          sharing.done();
        }}
      />
    </>
  );

  const supported: ReadonlySet<BulkActionId> = new Set<BulkActionId>(["share", "move", "download", "shelve", "trash", "unshelve", "restore", "purge"]);
  return { bulk: { supports: (action) => supported.has(action), run, busy }, dialogs };
}
