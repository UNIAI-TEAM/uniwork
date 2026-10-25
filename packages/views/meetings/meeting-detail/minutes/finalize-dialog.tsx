"use client";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogDescription } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { kitButton } from "../ui/kit-buttons";
import { Dialog440 } from "../ui/overlay";

/**
 * "Chốt biên bản?" (AfterMinutes): a 440 confirm that warns about the items
 * still waiting to be assigned and never blocks on them — the server only
 * warns too (brief §4.12). The count is `minutes.pending_items`, the same
 * number the strip and the state bar show.
 */
export function FinalizeDialog({
  open,
  onOpenChange,
  pending,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog440
      open={open}
      onOpenChange={onOpenChange}
      role="alertdialog"
      title={t("meetings.detail.minutes.finalizeTitle")}
      footer={
        <>
          <Button variant="ghost" size="lg" className={cn(kitButton.base, kitButton.ghost)} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="brand"
            size="lg"
            className={kitButton.base}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) onConfirm();
            }}
          >
            {busy ? <Spinner /> : null}
            {t("meetings.minutes.finalize")}
          </Button>
        </>
      }
    >
      <DialogDescription className="text-body-lg text-foreground">
        {pending > 0 ? (
          <span className="mt-3 flex items-start gap-2 font-medium text-warning">
            <TriangleAlert aria-hidden className="mt-0.75 size-4 shrink-0" />
            <span>{t("meetings.detail.minutes.pendingWarning", { count: pending })}</span>
          </span>
        ) : null}
        <span className={cn("block", pending > 0 ? "mt-1" : "mt-2")}>
          {t(pending > 0 ? "meetings.detail.minutes.finalizeBodyPending" : "meetings.detail.minutes.finalizeBody")}
        </span>
      </DialogDescription>
    </Dialog440>
  );
}
