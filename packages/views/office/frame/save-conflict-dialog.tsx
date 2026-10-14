"use client";

import { useRef, type ComponentProps } from "react";
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

interface SaveConflictDialogProps {
  open: boolean;
  /** Keep the edits open in the editor (the safe default). */
  onKeep: () => void;
  /** Replace the open edits with the newest version. */
  onReload: () => void;
  /** Where focus goes when the dialog closes: the editor frame, which is not a DOM element of this page. */
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
}

/**
 * The page header's Save met a newer version on the server. The frame owns this dialog for a save
 * it starts itself (Ctrl+S); for a save the page starts it answers `conflict` and leaves the words
 * to the host, so the same two choices appear here, in the host dialog family and the page language.
 */
export function SaveConflictDialog({ open, onKeep, onReload, finalFocus }: SaveConflictDialogProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.docsFrame.save_conflict" });
  const keep = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onKeep(); }}>
      <DialogContent className="sm:max-w-md" closeLabel={t("close")} initialFocus={keep} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col items-stretch sm:flex-col">
          <Button ref={keep} type="button" onClick={onKeep}>{t("keep")}</Button>
          <Button type="button" variant="destructive" onClick={onReload}>{t("reload")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
