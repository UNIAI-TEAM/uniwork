"use client";

import { useTranslation } from "react-i18next";
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

/**
 * UNI-2055 W3: asked before a folder leaves My Folder, because it and its
 * sub-folders become workspace folders (name visible to the whole workspace).
 * The documents inside keep their own access. The confirm is client-only: the
 * server sends no flag and the move request goes out only after "Chuyển".
 */
export function MoveOutConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("documents.home.move.out_confirm.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("documents.home.move.out_confirm.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button type="button" onClick={onConfirm}>
            {t("documents.home.move.out_confirm.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
