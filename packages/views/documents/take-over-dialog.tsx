"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import type { DocumentEditLockSummary } from "@uniwork/core/api/endpoints/documents-edit-lock";
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
import { Spinner } from "@uniwork/ui/components/ui/spinner";

export interface TakeOverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The R1 holder summary; for a manager it carries the tenure's `lock_id` (contract C2-1). */
  lock: DocumentEditLockSummary | null;
  /** R5 with the lock id this dialog showed; rejects with the server's ApiError. */
  onConfirm: (expectedLockId: string) => Promise<unknown>;
  /** The holder changed under the dialog: read R1 again. */
  onReread: () => void;
}

/**
 * "Take over editing from A?" (addendum §11.3, D3: a manager takes over
 * directly). The take-over names the tenure the manager was shown: if the
 * lock changed hands meanwhile the server answers 409 edit_lock_changed, the
 * dialog rereads, names the new holder and asks again. Focus starts on Cancel.
 */
export function TakeOverDialog({ open, onOpenChange, lock, onConfirm, onReread }: TakeOverDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [expected, setExpected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"changed" | "failed" | null>(null);
  const lockId = lock?.lock_id ?? null;

  // The tenure is read when the dialog opens, and again only after a change was reported.
  useEffect(() => {
    if (!open) return;
    setExpected(lockId);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open; a reread updates it below
  }, [open]);
  useEffect(() => {
    if (open && error === "changed") setExpected(lockId);
  }, [open, error, lockId]);

  const confirm = () => {
    if (!expected) return;
    setPending(true);
    setError(null);
    onConfirm(expected).then(
      () => {
        setPending(false);
        onOpenChange(false);
      },
      (err: unknown) => {
        setPending(false);
        const code = err instanceof ApiError ? err.code : "";
        if (code === "edit_lock_changed" || code === "edit_lock_free") {
          setExpected(null);
          setError("changed");
          onReread();
        } else {
          setError("failed");
        }
      },
    );
  };

  const name = lock?.holder_name || t("documents.editLock.lostSomeone");
  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogContent initialFocus={cancelRef} data-testid="take-over-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("documents.editLock.takeOverTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("documents.editLock.takeOverBody", { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {t(error === "changed" ? "documents.editLock.takeOverChanged" : "documents.editLock.takeOverFailed")}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={pending}>{t("documents.editLock.cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={pending || !expected || !lock} aria-busy={pending || undefined} onClick={confirm}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t("documents.editLock.takeOverConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
