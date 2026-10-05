"use client";

import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";

export interface PdfSignatureDeleteDialogProps {
  /** The signature awaiting confirmation; null keeps the dialog closed. */
  target: { id: string; label: string } | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Confirms deleting one saved signature. Cancel and Escape stay live while the
 * delete is in flight — the request cannot be aborted, but the user is not held
 * in the dialog by a slow server — so only the confirm action takes
 * `aria-disabled` (the button stays in the tab order to explain itself).
 */
export function PdfSignatureDeleteDialog({ target, pending, onOpenChange, onConfirm }: PdfSignatureDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={target !== null} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("office.pdf.signatures.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("office.pdf.signatures.deleteConfirm", { label: target?.label ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-disabled={pending || undefined}
            onClick={onConfirm}
          >
            {t("office.pdf.signatures.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
