"use client";

import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage } from "@uniwork/core/api";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import {
  useArchiveDocument,
  useDocumentTree,
  useRestoreDocument,
} from "@uniwork/core/documents/hooks-collections";
import type { Document, DocumentTreeNode } from "@uniwork/core/types/document";
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
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

export interface DocumentArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: Document;
  /** `archive` from a live document; `restore` from the trash. */
  mode: "archive" | "restore";
  /** Called after a verified archive, so the caller can leave the document. */
  onArchived?: () => void;
}

function subtreeCount(nodes: DocumentTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + subtreeCount(node.children ?? []), 0);
}

function firstName(nodes: DocumentTreeNode[]): string | null {
  return nodes.find((node) => node.title)?.title ?? null;
}

/**
 * Archive and restore confirmation (C-01 §5.1; G1-08, UNI-682).
 *
 * Archive shows the impact first: the subtree the command will move is read
 * before anything is confirmed, and the confirm stays disabled until that read
 * answers — an archive whose blast radius is unknown is not offered. Restore
 * explains the batch rule: exactly the group one archive moved comes back, and
 * a child whose parent stays in the trash returns to the workspace root.
 *
 * Both commands await a verifiable answer; a failure keeps the dialog and its
 * message, and nothing on screen moves until the server has answered.
 */
export function DocumentArchiveDialog({
  open,
  onOpenChange,
  wsId,
  doc,
  mode,
  onArchived,
}: DocumentArchiveDialogProps) {
  const { t } = useTranslation();
  const archive = useArchiveDocument(wsId);
  const restore = useRestoreDocument(wsId);
  const isArchive = mode === "archive";
  const subtree = useDocumentTree(wsId, doc.id, { enabled: open && isArchive });
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const pending = archive.isPending || restore.isPending;

  useEffect(() => {
    if (!open) {
      setError(null);
      keyRef.current = null;
    }
  }, [open]);

  const descendants = subtree.data ? subtreeCount(subtree.data.documents) : 0;
  const total = 1 + descendants;
  const firstChild = subtree.data ? firstName(subtree.data.documents) : null;

  const confirm = async () => {
    if (pending) return;
    setError(null);
    keyRef.current ??= createSafeId();
    try {
      if (isArchive) {
        const result = await archive.mutateAsync({
          documentId: doc.id,
          idempotencyKey: keyRef.current,
        });
        keyRef.current = null;
        toast.success(
          t("documents.archive.impact_count", { count: result.affected.length || total }),
        );
        onOpenChange(false);
        onArchived?.();
      } else {
        const result = await restore.mutateAsync({
          documentId: doc.id,
          idempotencyKey: keyRef.current,
        });
        keyRef.current = null;
        onOpenChange(false);
        if (result.affected.length > 1) {
          toast.success(t("documents.archive.impact_count", { count: result.affected.length }));
        }
      }
    } catch (err) {
      const cls = classifyDocumentError(err);
      if (isArchive && (cls.cls === "permission" || cls.cls === "missing")) {
        setError(t("documents.archive.archive_forbidden"));
      } else {
        setError(
          apiErrorMessage(err) ??
            t(isArchive ? "documents.archive.archive_failed" : "documents.archive.restore_failed"),
        );
      }
    }
  };

  const impactBody = (() => {
    if (!isArchive) return null;
    if (subtree.isPending) {
      return (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }
    if (subtree.isError || !subtree.data) {
      return (
        <div className="flex items-center justify-between gap-2">
          <p role="alert" className="text-caption text-destructive">
            {t("documents.archive.impact_error")}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void subtree.refetch()}>
            {t("documents.archive.retry")}
          </Button>
        </div>
      );
    }
    if (total <= 1) {
      return <p className="text-body text-muted-foreground">{t("documents.archive.impact_empty")}</p>;
    }
    return (
      <div className="flex flex-col gap-1">
        <p className="text-body text-foreground">{t("documents.archive.impact_count", { count: total })}</p>
        {firstChild ? (
          <p className="truncate text-caption text-muted-foreground">{firstChild}</p>
        ) : null}
        {descendants > 1 ? (
          <p className="text-caption text-muted-foreground">
            {t("documents.archive.impact_more", { count: descendants - 1 })}
          </p>
        ) : null}
      </div>
    );
  })();

  const blocked = isArchive && (subtree.isPending || subtree.isError || !subtree.data);

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !pending ? onOpenChange(false) : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(isArchive ? "documents.archive.archive_title" : "documents.archive.restore_title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(isArchive ? "documents.archive.archive_description" : "documents.archive.restore_description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {isArchive ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-label font-medium text-foreground">{t("documents.archive.impact_title")}</p>
            {impactBody}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <Button
            type="button"
            variant={isArchive ? "destructive" : "default"}
            disabled={pending || blocked}
            aria-busy={pending || undefined}
            onClick={() => void confirm()}
          >
            {pending ? (
              <>
                <Spinner aria-hidden role="presentation" />
                {t(isArchive ? "documents.archive.archive_submitting" : "documents.archive.restore_submitting")}
              </>
            ) : isArchive ? (
              <>
                <Trash2 aria-hidden className="size-3.5" />
                {t("documents.archive.archive_confirm")}
              </>
            ) : (
              <>
                <ArchiveRestore aria-hidden className="size-3.5" />
                {t("documents.archive.restore_confirm")}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
