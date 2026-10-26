"use client";

import { useId, type ReactNode } from "react";
import { CircleQuestionMark, Copy, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { meetingLocale } from "../meeting-datetime";
import { formatMeetingMoment } from "../meeting-detail-format";
import { formatRelativeTime } from "../meeting-relative-time";
import { SummaryFailureNotice } from "../meeting-summary/summary-generate-controls";
import type { SummaryGeneration } from "../meeting-summary/use-summary-generation";
import { ScribeSign } from "../scribe-sign";
import { useNow } from "../use-now";

const CARD = "rounded-[14px] border border-border pt-3 pr-3 pb-2.5 pl-3.5";
const ICON_BUTTON = "text-muted-foreground";

function summaryLines(text: string, locale: string): string[] {
  // The tldr is a few sentences in one paragraph; the Main board gives each sentence its own bullet.
  // A browser without Intl.Segmenter keeps each line whole.
  const sentences = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(locale, { granularity: "sentence" }) : null;
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .flatMap((line) => (sentences ? Array.from(sentences.segment(line), (s) => s.segment.trim()) : [line]))
    .filter(Boolean);
}

/** ↻ / Create: through requestGenerate, which asks before replacing a summary people may have read. */
function GenerateButton({ gen, label, children }: { gen: SummaryGeneration; label?: string; children: ReactNode }) {
  const reasonId = useId();
  const blocked = gen.blockedReason !== null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={label ? "icon-sm" : "sm"}
        className={label ? ICON_BUTTON : undefined}
        aria-label={label}
        aria-disabled={blocked || undefined}
        aria-busy={gen.generating || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        title={gen.blockedReason ?? undefined}
        onClick={gen.requestGenerate}
      >
        {children}
      </Button>
      {/* The title is for the pointer; a screen reader hears why from here. */}
      {blocked ? (
        <span id={reasonId} className="sr-only">
          {gen.blockedReason}
        </span>
      ) : null}
    </>
  );
}

/**
 * The top of the room's UNI feed: the AI summary so far, refreshed by hand
 * (owner decision: no automatic regeneration), with what it read and which
 * model wrote it one hover away. The caller keeps the confirm dialog and the
 * live region; the card only says the state it is in.
 */
export function MeetingSummaryCard({ gen, sourcesLabel }: { gen: SummaryGeneration; sourcesLabel: string | null }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const nowMs = useNow();
  const summary = gen.summary;
  const locale = meetingLocale(i18n.language);

  if (!summary && !gen.generating) {
    // Before the first summary the card is only an offer, and only to whoever may make one. A summary that
    // failed to load is not known to be missing: Create would replace it without asking.
    if (!gen.showGenerate || gen.summaryQuery.isError || !(gen.hasSource || gen.failure)) return null;
    return (
      <section aria-label={t("meetings.panel.summary.title")} className={CARD}>
        <div className="flex items-center gap-2 text-label text-muted-foreground">
          <ScribeSign className="mr-0" />
          <span className="min-w-0 flex-1">{t("meetings.panel.summary.none")}</span>
          <GenerateButton gen={gen}>
            <RefreshCw aria-hidden data-icon="inline-start" />
            {t("meetings.panel.summary.create")}
          </GenerateButton>
        </div>
        <SummaryFailureNotice gen={gen} tone="warning" className="mt-2" />
      </section>
    );
  }

  const lines = summary ? summaryLines(summary.summary, meetingLocale(i18n.language)) : [];
  const createdAt = summary?.created_at ?? null;

  const onCopy = async () => {
    if (lines.length === 0) return;
    try {
      await navigator.clipboard.writeText(`${t("meetings.summaryTab")}:\n${lines.map((l) => `- ${l}`).join("\n")}`);
      toast.success(t("meetings.copyNotes"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  return (
    <section aria-labelledby={headingId} className={CARD}>
      <div className="mb-2 flex items-center gap-2">
        <h2 id={headingId} className="font-display text-body font-semibold text-foreground">
          {t("meetings.panel.summary.title")}
        </h2>
        {createdAt ? (
          <span className="text-caption text-faint-foreground">
            {formatRelativeTime(createdAt, locale, nowMs, t("meetings.justNow"))}
          </span>
        ) : null}
        <div className="flex-1" />
        {summary && gen.showGenerate ? (
          <GenerateButton gen={gen} label={t("meetings.panel.summary.update")}>
            <RefreshCw aria-hidden />
          </GenerateButton>
        ) : null}
        {lines.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={ICON_BUTTON}
            aria-label={t("meetings.panel.summary.copy")}
            onClick={() => void onCopy()}
          >
            <Copy aria-hidden />
          </Button>
        ) : null}
      </div>

      {gen.generating ? (
        <p className="ai-shimmer text-body">{t("meetings.summarizing")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-[9px] text-body text-foreground">
              <span aria-hidden className="mt-2 size-[5px] shrink-0 rounded-full bg-faint-foreground" />
              <span className="min-w-0 text-pretty">{line}</span>
            </li>
          ))}
        </ul>
      )}

      <SummaryFailureNotice gen={gen} tone="warning" className="mt-2" />

      {summary ? (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-dashed border-border pt-[9px] text-caption text-muted-foreground">
          <ScribeSign className="mr-0" />
          {sourcesLabel ? <span className="min-w-0">{sourcesLabel}</span> : null}
          <Popover>
            <PopoverTrigger
              openOnHover
              delay={150}
              aria-label={t("meetings.panel.summary.sourcesHelp")}
              // A 44 hit area on touch drawn as an overlay, so the row keeps its height.
              className="relative grid size-5 shrink-0 place-items-center rounded-full text-faint-foreground hover:text-foreground data-[popup-open]:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']"
            >
              <CircleQuestionMark aria-hidden className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] gap-1 p-3 text-caption">
              {/* A summary with a model was asked for; one without is the automatic catch-up. */}
              <p className="font-medium text-foreground">{summary.model || t("meetings.summaryAi.auto")}</p>
              {createdAt ? <p className="text-muted-foreground">{formatMeetingMoment(createdAt, locale)}</p> : null}
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
    </section>
  );
}
