"use client";

import { useState } from "react";
import { FileWarning, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
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
  /**
   * The server's CURRENT base, read after the user asked to keep their copy.
   * Until this is set the dialog only offers the choice; the commit happens on
   * the revision shown here, never on the number from the failed save. The
   * `contentText` excerpt is the plain text of that copy, so the user can see
   * what they are about to write on top of.
   */
  serverBase?: {
    revision: string;
    updatedAt: string | null;
    contentText?: string | null;
  } | null;
  keepMinePending?: boolean;
  /** Reading the fresh base failed: stay on step one and let the user retry. */
  keepMineError?: boolean;
  /** Read the server's current base and show it (step one). */
  onKeepMine: () => void;
  /** Commit the local copy on the base shown (step two). */
  onConfirmKeepMine: () => void;
  /** Back to the two choices without committing anything. */
  onBackFromServerBase: () => void;
  /** Drop the local copy and show the committed one. */
  onLoadServer: () => void;
  pending?: boolean;
}

/** Today is named by its clock; any other day carries the date too. Locale
 *  comes from the active i18n language, like the file view's formatting. */
function formatBaseTime(at: Date, locale: string): string {
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at);
}

/** A bounded, read-only excerpt of the server copy's text. */
function excerptOf(contentText: string | null | undefined): string {
  const trimmed = contentText?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
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
  serverBase,
  keepMinePending = false,
  keepMineError = false,
  onKeepMine,
  onConfirmKeepMine,
  onBackFromServerBase,
  onLoadServer,
  pending = false,
}: DocumentConflictDialogProps) {
  const { t, i18n } = useTranslation();
  const [confirmLoad, setConfirmLoad] = useState(false);
  const baseAt = serverBase?.updatedAt ? new Date(serverBase.updatedAt) : null;
  const baseTime =
    baseAt && !Number.isNaN(baseAt.getTime()) ? formatBaseTime(baseAt, i18n.language) : "";
  const baseExcerpt = excerptOf(serverBase?.contentText);

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
          {serverBase ? (
            <div
              className="rounded-lg border border-border bg-muted/40 px-3 py-3"
              data-testid="conflict-server-base"
            >
              <p className="text-body font-medium text-foreground">
                {t("documents.conflict.server_base_title")}
              </p>
              <p className="mt-1 text-caption text-muted-foreground">
                {t("documents.conflict.server_base_description", {
                  revision: serverBase.revision,
                  time: baseTime,
                })}
              </p>
              {baseExcerpt ? (
                <div className="mt-2 rounded-md border border-border bg-background px-2 py-1.5">
                  <p className="text-caption font-medium text-muted-foreground">
                    {t("documents.conflict.server_base_excerpt")}
                  </p>
                  <p
                    className="mt-1 max-h-24 overflow-hidden text-caption whitespace-pre-wrap break-words text-foreground"
                    data-testid="conflict-server-base-text"
                  >
                    {baseExcerpt}
                  </p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={onBackFromServerBase}
                >
                  {t("documents.conflict.back")}
                </Button>
                <Button type="button" size="sm" disabled={pending} onClick={onConfirmKeepMine}>
                  {t("documents.conflict.confirm_keep_mine")}
                </Button>
              </div>
            </div>
          ) : (
          <div className="flex flex-col gap-2">
            {keepMineError ? (
              <p role="alert" className="text-caption text-destructive">
                {t("documents.conflict.keep_mine_error")}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full flex-col items-start gap-1 px-3 py-3 text-left whitespace-normal"
              disabled={pending || keepMinePending}
              aria-busy={keepMinePending || undefined}
              onClick={onKeepMine}
            >
              <span className="flex items-center gap-2 text-body font-medium">
                {keepMinePending ? (
                  <Spinner aria-hidden role="presentation" />
                ) : (
                  <FileWarning aria-hidden className="size-4" />
                )}
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
          )}
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
