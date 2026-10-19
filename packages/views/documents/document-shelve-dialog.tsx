"use client";

import { useEffect, useRef, useState } from "react";
import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { classifyDocumentError, isFolderTooLargeError } from "@uniwork/core/documents/errors";
import { useDocumentArchiveImpact, useShelveDocument } from "@uniwork/core/documents/hooks-collections";
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
import { documentErrorMessage } from "./document-error-message";

export interface DocumentShelveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  /** The folder being shelved (a library row is enough: only its id, kind and title are read). */
  doc: { id: string; kind: string; title?: string };
  /** Called after a verified shelve, so the caller can leave the document. */
  onShelved?: () => void;
}

/**
 * Shelve-a-folder confirmation (ARCHIVE-01 U-4), the archive dialog's shelved
 * twin (Q-UI1 reuses `archive-impact`): it reads the server's subfolder and
 * document counts, locks confirmation until they arrive, replaces the confirm
 * button when `too_large` is true, and surfaces 403/404 as the subtree
 * permission message. The copy is the shelved one: the whole folder and
 * everything inside becomes read-only, not deleted. The command awaits a
 * verifiable answer; a failure keeps the dialog and its message.
 */
export function DocumentShelveDialog({ open, onOpenChange, wsId, doc, onShelved }: DocumentShelveDialogProps) {
  const { t } = useTranslation();
  const shelve = useShelveDocument(wsId);
  const impact = useDocumentArchiveImpact(wsId, doc.id, { enabled: open });
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const pending = shelve.isPending;

  useEffect(() => {
    if (!open) {
      setError(null);
      keyRef.current = null;
    }
  }, [open]);

  const confirm = async () => {
    if (pending) return;
    setError(null);
    keyRef.current ??= createSafeId();
    try {
      const result = await shelve.mutateAsync({ documentId: doc.id, idempotencyKey: keyRef.current });
      keyRef.current = null;
      const title = result.document.title || doc.title || t("documents.detail.untitled");
      toast.success(t("documents.shelved_list.toast.shelved", { title }));
      onOpenChange(false);
      onShelved?.();
    } catch (err) {
      const cls = classifyDocumentError(err);
      if (cls.cls === "permission" || cls.cls === "missing") {
        setError(t("documents.shelved_list.shelve_forbidden"));
      } else if (isFolderTooLargeError(err)) {
        setError(t("documents.shelved_list.too_large"));
      } else {
        setError(documentErrorMessage(err, t, "documents.shelved_list.shelve_failed"));
      }
    }
  };

  const impactLoading = impact.isPending || impact.isFetching;
  const tooLarge = !impactLoading && !impact.isError && impact.data?.too_large === true;
  const impactCls = impact.isError ? classifyDocumentError(impact.error).cls : null;
  // 403/404 on the impact read: nothing the user can retry, so no confirm either.
  const impactRefused = !impactLoading && (impactCls === "permission" || impactCls === "missing");

  const folderImpactBody = (() => {
    if (impactLoading) {
      return (
        <div className="space-y-2" aria-busy="true">
          <AlertDialogDescription className="text-caption text-muted-foreground">
            {t("documents.shelved_list.shelve_loading")}
          </AlertDialogDescription>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      );
    }
    if (impact.isError || !impact.data) {
      if (impactRefused) {
        return (
          <AlertDialogDescription render={<p role="alert" className="text-caption text-destructive" />}>
            {t("documents.shelved_list.shelve_forbidden")}
          </AlertDialogDescription>
        );
      }
      return (
        <div className="flex items-center justify-between gap-2">
          <AlertDialogDescription render={<p role="alert" className="text-caption text-destructive" />}>
            {t("documents.archive.delete_impact_error")}
          </AlertDialogDescription>
          <Button type="button" variant="outline" size="sm" onClick={() => void impact.refetch()}>
            {t("documents.archive.retry")}
          </Button>
        </div>
      );
    }
    if (impact.data.too_large) {
      return (
        <AlertDialogDescription render={<p role="alert" className="text-body text-destructive" />}>
          {t("documents.shelved_list.too_large")}
        </AlertDialogDescription>
      );
    }
    return (
      <AlertDialogDescription className="text-body text-muted-foreground">
        {t("documents.shelved_list.shelve_folder_body", {
          subfolders: t("documents.shelved_list.shelve_subfolders", { count: impact.data.folders }),
          documents: t("documents.shelved_list.shelve_documents", { count: impact.data.documents }),
        })}
      </AlertDialogDescription>
    );
  })();

  const blocked = impactLoading || impact.isError || !impact.data || tooLarge;

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !pending ? onOpenChange(false) : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("documents.shelved_list.shelve_title")}</AlertDialogTitle>
          {folderImpactBody}
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          {!tooLarge && !impactRefused ? (
            <Button
              type="button"
              variant="default"
              disabled={pending || blocked}
              aria-busy={pending || undefined}
              onClick={() => void confirm()}
            >
              {pending ? (
                <>
                  <Spinner aria-hidden role="presentation" />
                  {t("documents.shelved_list.shelve_submitting")}
                </>
              ) : (
                <>
                  <Archive aria-hidden className="size-3.5" />
                  {t("documents.shelved_list.shelve_confirm")}
                </>
              )}
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
