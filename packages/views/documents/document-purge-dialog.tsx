"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { usePurgeDocument } from "@uniwork/core/documents/hooks-collections";
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
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { trashErrorMessage } from "./document-error-message";
import type { DocumentSummaryRow } from "./library-rows";

export interface DocumentPurgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  doc: DocumentSummaryRow;
}

/**
 * Permanent delete from the trash (RESTORE-01 §2, Trash.dc): one destructive
 * confirmation that names the item, says it cannot be undone, and — for a
 * folder — that children the viewer does not manage stay in the trash. The
 * command awaits the server; a refusal (folder_too_large, not_in_trash, 403)
 * stays in the dialog with its own sentence, and nothing on screen moves
 * before the answer.
 */
export function DocumentPurgeDialog({ open, onOpenChange, wsId, doc }: DocumentPurgeDialogProps) {
  const { t } = useTranslation();
  const purge = usePurgeDocument(wsId);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const pending = purge.isPending;

  useEffect(() => {
    if (!open) {
      setError(null);
      keyRef.current = null;
    }
  }, [open]);

  const title = doc.title || t("documents.detail.untitled");
  const folder = doc.kind === "folder";

  const confirm = async () => {
    if (pending) return;
    setError(null);
    keyRef.current ??= createSafeId();
    try {
      await purge.mutateAsync({ documentId: doc.id, idempotencyKey: keyRef.current });
      keyRef.current = null;
      onOpenChange(false);
      toast.success(t("documents.trash.purged", { title }));
    } catch (failure) {
      setError(trashErrorMessage(failure, t, "documents.trash.purge_failed"));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !pending ? onOpenChange(false) : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("documents.trash.purge_title", { title })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(folder ? "documents.trash.purge_folder_description" : "documents.trash.purge_description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => void confirm()}
          >
            {pending ? (
              <>
                <Spinner aria-hidden role="presentation" />
                {t("documents.trash.purging")}
              </>
            ) : (
              <>
                <Trash2 aria-hidden className="size-3.5" />
                {t("documents.trash.purge")}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
