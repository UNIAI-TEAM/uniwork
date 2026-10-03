"use client";

// A12 (UNI-924): the review ▸ tracked-changes pane. Presentational on purpose —
// the toolbar group owns open/jump state and calls the command runtime; this
// file renders the change list (kind, author, date, snippet), per-change
// accept/reject, the bulk actions behind a confirmation, and the
// loading/empty/read-only states.
import { Check, History, X } from "lucide-react";
import { useState } from "react";
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
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@uniwork/ui/components/ui/empty";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { DOCX_REVIEW_KIND_LABEL_KEYS, type DocxReviewChange } from "./revision-model";

export interface DocxReviewPanelProps {
  /** null = the list has not been read yet (no editor / command runtime). */
  changes: DocxReviewChange[] | null;
  /** Change whose range was last jumped to (row highlight). */
  activeId: string | null;
  readOnly: boolean;
  /** A save is in flight; actions are held back with it. */
  busy: boolean;
  onAccept(id: string): void;
  onReject(id: string): void;
  onAcceptAll(): void;
  onRejectAll(): void;
  onJump(id: string): void;
  onClose(): void;
}

function formatChangeDate(date: string | undefined, language: string): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(parsed);
}

export function DocxReviewPanel({
  changes,
  activeId,
  readOnly,
  busy,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onJump,
  onClose,
}: DocxReviewPanelProps) {
  const { t, i18n } = useTranslation();
  const [bulk, setBulk] = useState<"accept" | "reject" | null>(null);
  const blocked = readOnly || busy;
  const count = changes?.length ?? 0;

  const kindLabel = (change: DocxReviewChange): string => t(DOCX_REVIEW_KIND_LABEL_KEYS[change.kind]);

  const confirmBulk = (): void => {
    if (bulk === "reject") onRejectAll();
    else if (bulk === "accept") onAcceptAll();
    setBulk(null);
  };

  return (
    <div className="flex max-h-[70vh] w-full min-w-0 flex-col gap-2" data-testid="docx-review-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-heading text-title-sm font-medium">
          <History aria-hidden />
          <span className="truncate">{t("office.docx.review.title")}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {count > 0 ? <span className="text-caption text-muted-foreground">{t("office.docx.review.changeCount", { count })}</span> : null}
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("office.docx.review.close")} onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
      </div>

      {readOnly ? <p className="text-caption text-muted-foreground">{t("office.docx.review.readOnlyNote")}</p> : null}

      {changes !== null && count > 0 ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked}
            data-testid="docx-review-accept-all"
            onClick={() => setBulk("accept")}
          >
            <Check aria-hidden />
            {t("office.docx.review.acceptAll")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={blocked}
            data-testid="docx-review-reject-all"
            onClick={() => setBulk("reject")}
          >
            <X aria-hidden />
            {t("office.docx.review.rejectAll")}
          </Button>
        </div>
      ) : null}

      <Separator />

      {changes === null ? (
        <div className="flex items-center justify-center gap-2 p-4 text-body text-muted-foreground">
          <Spinner />
          {t("office.docx.review.loading")}
        </div>
      ) : count === 0 ? (
        <Empty className="border-0 p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History aria-hidden />
            </EmptyMedia>
            <EmptyTitle as="h3">{t("office.docx.review.empty")}</EmptyTitle>
            <EmptyDescription>{t("office.docx.review.emptyHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
          {changes.map((change) => {
            const label = kindLabel(change);
            const date = formatChangeDate(change.date, i18n.language);
            const active = activeId === change.id;
            return (
              <li
                key={change.id}
                className={cn(
                  "flex flex-col gap-1 rounded-lg p-2 ring-1 ring-surface-border",
                  active ? "bg-surface-hover" : "bg-surface-raised",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="secondary">{label}</Badge>
                  <span className="min-w-0 flex-1 truncate text-caption font-medium">
                    {change.author || t("office.docx.editor.editorUnknownAuthor")}
                  </span>
                  {date ? <span className="shrink-0 text-caption text-muted-foreground">{date}</span> : null}
                </div>
                <button
                  type="button"
                  className="w-full truncate text-left text-body hover:text-foreground"
                  aria-label={`${t("office.docx.review.jump")}: ${change.snippet || label}`}
                  onClick={() => onJump(change.id)}
                >
                  {change.snippet || label}
                </button>
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={blocked}
                    aria-label={t("office.docx.review.acceptChange", { kind: label })}
                    onClick={() => onAccept(change.id)}
                  >
                    <Check aria-hidden />
                    {t("office.docx.review.accept")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={blocked}
                    aria-label={t("office.docx.review.rejectChange", { kind: label })}
                    onClick={() => onReject(change.id)}
                  >
                    <X aria-hidden />
                    {t("office.docx.review.reject")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={bulk !== null} onOpenChange={(next) => { if (!next) setBulk(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{bulk === "reject" ? t("office.docx.review.rejectAllTitle") : t("office.docx.review.acceptAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {bulk === "reject"
                ? t("office.docx.review.rejectAllDescription", { count })
                : t("office.docx.review.acceptAllDescription", { count })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("office.docx.review.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant={bulk === "reject" ? "destructiveSolid" : "default"} onClick={confirmBulk}>
              {bulk === "reject" ? t("office.docx.review.confirmRejectAll") : t("office.docx.review.confirmAcceptAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
