"use client";

import { useState } from "react";
import { FileWarning, History } from "lucide-react";
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
import { ConfirmDialog } from "../common/form-dialog";

export interface DocumentConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The revision the local copy patched. */
  mineRevision: string;
  /** The revision the server holds now (`fields.current_revision`). */
  serverRevision: string;
  /** Keep the local copy and save it on the server's current base. */
  onKeepMine: () => void;
  /** Drop the local copy and show the committed one. */
  onLoadServer: () => void;
  pending?: boolean;
}

/**
 * "Nguoi khac vua luu" (C-01 §7.3, FE design §6.3).
 *
 * Both revisions are named before anything is chosen, and loading the server
 * copy asks once more: it is the only branch that throws a user's own edits
 * away. Keeping the local copy does NOT save from inside the dialog — the
 * caller re-bases on the revision shown here and lets autosave commit, so a
 * third writer landing in between comes back to this same dialog.
 */
export function DocumentConflictDialog({
  open,
  onOpenChange,
  mineRevision,
  serverRevision,
  onKeepMine,
  onLoadServer,
  pending = false,
}: DocumentConflictDialogProps) {
  const { t } = useTranslation();
  const [confirmLoad, setConfirmLoad] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" showCloseButton closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("documents.conflict.title")}</DialogTitle>
            <DialogDescription>
              {t("documents.conflict.description", {
                mine: mineRevision,
                theirs: serverRevision,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full flex-col items-start gap-1 px-3 py-3 text-left whitespace-normal"
              disabled={pending}
              onClick={onKeepMine}
            >
              <span className="flex items-center gap-2 text-body font-medium">
                <FileWarning aria-hidden className="size-4" />
                {t("documents.conflict.keep_mine")}
              </span>
              <span className="text-caption font-normal text-muted-foreground">
                {t("documents.conflict.keep_mine_hint")}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full flex-col items-start gap-1 px-3 py-3 text-left whitespace-normal"
              disabled={pending}
              onClick={() => setConfirmLoad(true)}
            >
              <span className="flex items-center gap-2 text-body font-medium">
                <History aria-hidden className="size-4" />
                {t("documents.conflict.load_server")}
              </span>
              <span className="text-caption font-normal text-muted-foreground">
                {t("documents.conflict.load_server_hint")}
              </span>
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("documents.conflict.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmLoad}
        onOpenChange={setConfirmLoad}
        title={t("documents.conflict.load_server_confirm_title")}
        description={t("documents.conflict.load_server_confirm_description")}
        confirmLabel={t("documents.conflict.confirm_load")}
        pending={pending}
        onConfirm={() => {
          setConfirmLoad(false);
          onLoadServer();
        }}
      />
    </>
  );
}
