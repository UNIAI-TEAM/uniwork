"use client";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { ConfirmDialog } from "../../common/form-dialog";
import type { SummaryGeneration } from "./use-summary-generation";

/**
 * Generate / regenerate. While the model works it shows a spinner and holds
 * still with aria-disabled (it stays in the tab order, and says why through
 * aria-describedby when a reason element is rendered), never native disabled.
 */
export function SummaryGenerateButton({
  gen,
  variant,
  reasonId,
  className,
}: {
  gen: SummaryGeneration;
  variant: "brandSubtle" | "outline";
  /** Id of the element that says why the button cannot be pressed, when one is shown. */
  reasonId?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!gen.showGenerate) return null;
  const blocked = gen.blockedReason !== null;
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={className}
      aria-disabled={blocked || undefined}
      aria-busy={gen.generating || undefined}
      aria-describedby={blocked && reasonId ? reasonId : undefined}
      title={gen.blockedReason ?? undefined}
      onClick={gen.requestGenerate}
    >
      {gen.generating ? <Spinner data-icon="inline-start" /> : <Sparkles aria-hidden />}
      {gen.generating
        ? t("meetings.summarizing")
        : gen.summary
          ? t("meetings.regenerateSummary")
          : t("meetings.generateSummary")}
    </Button>
  );
}

/** Replacing a summary others may have read is asked first, on both screens. */
export function SummaryRegenerateConfirm({ gen }: { gen: SummaryGeneration }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={gen.confirmOpen}
      onOpenChange={gen.setConfirmOpen}
      title={t("meetings.regenerateSummaryTitle")}
      description={t("meetings.regenerateSummaryHint")}
      confirmLabel={t("meetings.regenerateSummaryConfirm")}
      pending={gen.generating}
      onConfirm={gen.confirmGenerate}
    />
  );
}

/**
 * One polite live region per screen: "generating…", "done", the error, and
 * the task batch's progress, for people who cannot see the spinner.
 */
export function SummaryLiveRegion({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="summary-live-region">
      {message}
    </p>
  );
}
