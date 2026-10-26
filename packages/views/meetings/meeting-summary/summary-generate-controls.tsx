"use client";
import { useCallback, useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../../common/form-dialog";
import { Notice, type NoticeTone } from "../../common/notice";
import type { SummaryGeneration } from "./use-summary-generation";

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
 * The last run's failure, on the card it failed on. The live region already
 * said it, so the notice stays quiet; Retry only where a second try can help,
 * and through the same door as the button: it asks before replacing a summary.
 */
export function SummaryFailureNotice({
  gen,
  tone = "destructive",
  className,
}: {
  gen: SummaryGeneration;
  /** The room's summary card says it as an amber strip inside the card. */
  tone?: NoticeTone;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!gen.failure) return null;
  return (
    <Notice
      tone={tone}
      icon={CircleAlert}
      layout="inline"
      live="off"
      className={className}
      action={
        gen.failure.retryable ? (
          <Button type="button" variant="outline" size="sm" onClick={gen.requestGenerate}>
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    >
      {gen.failure.text}
    </Notice>
  );
}

/** What a SummaryLiveRegion says; `seq` grows on every announce, so the same words can be said twice. */
type Announcement = { text: string; seq: number };

/** State for a SummaryLiveRegion: `announce("Đã bỏ qua việc.")` twice is heard twice. */
export function useAnnouncement(): [Announcement, (text: string) => void] {
  const [announcement, setAnnouncement] = useState<Announcement>({ text: "", seq: 0 });
  const announce = useCallback((text: string) => setAnnouncement((prev) => ({ text, seq: prev.seq + 1 })), []);
  return [announcement, announce];
}

/**
 * One polite live region per screen: "generating…", "done", the error, and
 * the task batch's progress, for people who cannot see the spinner. Each new
 * `seq` empties the region and refills it a tick later: an unchanged text
 * would be no DOM change, and a screen reader says nothing.
 */
export function SummaryLiveRegion({ message, seq = 0 }: { message: string; seq?: number }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText("");
    if (!message) return;
    const id = window.setTimeout(() => setText(message), 50);
    return () => window.clearTimeout(id);
  }, [message, seq]);
  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="summary-live-region">
      {text}
    </p>
  );
}
