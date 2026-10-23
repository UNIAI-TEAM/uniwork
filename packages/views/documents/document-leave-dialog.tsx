"use client";

import { FileExclamationPoint } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";

/** Leaving a document with unsaved changes (C-01 §7.3, FE design §5.4): stay, discard, or save and leave. */
export function DocumentLeaveDialog({
  open,
  pending,
  caption,
  failed = false,
  onStay,
  onDiscard,
  onSaveAndLeave,
}: {
  open: boolean;
  /** "Save and leave" is waiting for the write: every choice waits with it. */
  pending: boolean;
  /** One line: the wait, the failure, or the plain unsaved remark. */
  caption: string;
  /** The caption reports a failed save: announced assertively. */
  failed?: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !pending ? onStay() : undefined)}>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending} closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("documents.leave.title")}</DialogTitle>
          <DialogDescription>{t("documents.leave.description")}</DialogDescription>
        </DialogHeader>
        <div
          role={failed ? "alert" : "status"}
          className={failed ? "flex items-center gap-2 text-caption text-destructive" : "flex items-center gap-2 text-caption text-muted-foreground"}
        >
          <FileExclamationPoint aria-hidden className="size-4" />
          {caption}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" aria-disabled={pending || undefined} onClick={onStay}>
            {t("documents.leave.stay")}
          </Button>
          <Button type="button" variant="ghost" aria-disabled={pending || undefined} onClick={onDiscard}>
            {t("documents.leave.discard")}
          </Button>
          <Button type="button" aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={onSaveAndLeave}>
            {pending ? t("documents.leave.waiting") : t("documents.leave.save_and_leave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
