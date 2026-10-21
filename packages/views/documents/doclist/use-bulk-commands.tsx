"use client";

import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { BulkFailure } from "@uniwork/core/documents/bulk";
import { useBulkDocumentCommand, type BulkDocumentCommand } from "@uniwork/core/documents/hooks-bulk";
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
import { FolderPickerDialog } from "../folder-picker-dialog";
import type { BulkActionId, BulkPlan, DocListBulk } from "./bulk-actions";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The reasons the error list words; any other code reads "did not go through". */
const REASONS = new Set(["forbidden", "not_found", "conflict", "rate_limited", "not_verifiable", "not_a_file", "too_large", "folder_too_large"]);
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

type Pending = { plan: BulkPlan; done: () => void };

/**
 * What the bulk bar's actions do (UNI-2045 W9, contract §7). Restore, unshelve
 * and shelve run at once; the trash and the purge ask once for the batch;
 * the move asks for its target once; then the batch fans out over the
 * single-document routes (core `useBulkDocumentCommand`, at most four at a
 * time, one invalidation at the end) and one toast says "Đã … 3/5 tài liệu"
 * with the documents it could not act on. Tải xuống waits for the SV-9 zip job. Share is not offered: the
 * share dialog takes one document (reported in W9).
 */
export function useDocListBulkCommands({
  wsId,
  tree,
}: {
  wsId: string;
  /** The folder tree, for the move target picker. */
  tree: DocumentTreeNode[];
}): { bulk: DocListBulk; dialogs: ReactNode } {
  const { t } = useTranslation();
  const command = useBulkDocumentCommand(wsId);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [moving, setMoving] = useState<Pending | null>(null);

  const report = (plan: BulkPlan, ok: number, failures: BulkFailure[], id?: string | number) => {
    const title = t(`documents.list.bulk.done.${plan.action}`, { ok, total: plan.total });
    const description = failures.length > 0 ? <BulkErrorList failures={failures} titles={plan.titles} t={t} /> : undefined;
    (ok > 0 ? toast.success : toast.error)(title, { description, id });
  };

  const execute = async ({ plan, done }: Pending, parentId: string | null = null) => {
    const result = await command.mutateAsync({ command: plan.action as BulkDocumentCommand, ids: plan.docs.map((doc) => doc.id), parentId });
    report(plan, result.ok.length, [...result.failed, ...plan.skipped]);
    done();
  };

  const run = (plan: BulkPlan, done: () => void) => {
    const pending = { plan, done };
    switch (plan.action) {
      case "trash":
      case "purge":
        setConfirming(pending);
        return;
      case "move":
        setMoving(pending);
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
  const busy = command.isPending;
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
          if (!next && !busy) setMoving(null);
        }}
        title={t("documents.list.bulk.move.title", { count: moving?.plan.docs.length ?? 0 })}
        description={t("documents.list.bulk.move.description")}
        submitLabel={t("documents.home.move.submit")}
        pickerLabel={t("documents.home.move.picker_label")}
        rootLabel={t("documents.home.move.root")}
        tree={tree}
        initialFolderId={null}
        pending={busy}
        error={null}
        onSubmit={(target) => {
          if (!moving || busy) return;
          void execute(moving, target).finally(() => setMoving(null));
        }}
      />
    </>
  );

  const supported: ReadonlySet<BulkActionId> = new Set<BulkActionId>(["move", "shelve", "trash", "unshelve", "restore", "purge"]);
  return { bulk: { supports: (action) => supported.has(action), run }, dialogs };
}
