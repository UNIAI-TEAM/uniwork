"use client";
import { useId } from "react";
import { Info, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { formatRelativeTime } from "./meeting-relative-time";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingSummary } from "@uniwork/core/types/meeting";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { MeetingDecisionsBlock } from "./meeting-decisions-block";
import { PanelCard } from "../common/panel-card";
import { MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import {
  SummaryGenerateButton,
  SummaryLiveRegion,
  SummaryRegenerateConfirm,
} from "./meeting-summary/summary-generate-controls";
import { summarySourceFacts, summarySourceList, type SummarySourceTimes } from "./meeting-summary/summary-sources";
import { useSummaryGeneration } from "./meeting-summary/use-summary-generation";

/**
 * The AI summary and the decisions (a clerk generates; everyone reads). Shown
 * once a meeting has started. What it reads lives in MeetingTranscriptPanel,
 * the action items it proposes in MeetingActionItemsSection.
 */
export function MeetingSummaryPanel({
  workspaceId,
  meeting,
  canClerk,
}: {
  workspaceId: string;
  meeting: Meeting;
  canClerk: boolean;
}) {
  const { t } = useTranslation();
  const meetingId = meeting.id;
  const gen = useSummaryGeneration({ workspaceId, meetingId, canClerk });
  const { summary, summaryQuery, transcriptQuery } = gen;
  const transcript = transcriptQuery.data;
  // The empty copy depends on both (no summary → "needs a source" or
  // "no summary yet"), so neither is claimed until both have answered.
  const summaryLoading = summaryQuery.isPending || transcriptQuery.isPending;
  const summaryFailed = (summaryQuery.isError && !summary) || (transcriptQuery.isError && !transcript);
  const retrySummary = () => {
    if (summaryQuery.isError) void summaryQuery.refetch();
    if (transcriptQuery.isError) void transcriptQuery.refetch();
  };
  const reasonId = useId();

  const decisions = summary?.decisions ?? [];
  const aiOff = !gen.aiOn && gen.capsLoaded;
  const showNeedsSource = gen.showGenerate && !gen.hasSource && !summaryLoading && !summaryFailed;
  // One sentence for an empty summary: why there is none and what would make one.
  const emptyText = aiOff
    ? t("meetings.aiUnavailable")
    : gen.hasSource
      ? t("meetings.summaryEmpty")
      : gen.showGenerate
        ? t("meetings.summaryNeedsSource")
        : t("meetings.summaryEmptyReadOnly");

  return (
    <PanelCard
      id="summary-heading"
      icon={Sparkles}
      iconTone="brand"
      tone="brand"
      title={t("meetings.summaryTitle")}
      action={
        <SummaryGenerateButton
          gen={gen}
          variant={summary ? "outline" : "default"}
          reasonId={showNeedsSource ? reasonId : undefined}
        />
      }
    >
      <SummaryLiveRegion message={gen.announcement} />
      <div className="space-y-4" data-testid="meeting-summary-panel">
        {summary ? (
          <div className="space-y-4">
            <SummaryAttribution summary={summary} times={gen.sourceTimes} />
            <p className="max-w-prose whitespace-pre-wrap text-pretty text-body text-foreground">{summary.summary}</p>
            <MeetingDecisionsBlock meetingId={meetingId} voted={gen.voted} aiDecisions={decisions} />
          </div>
        ) : summaryLoading ? (
          <MeetingTextSkeleton />
        ) : summaryFailed ? (
          <MeetingSectionError message={t("meetings.summaryLoadFailed")} onRetry={retrySummary} />
        ) : (
          <p id={showNeedsSource ? reasonId : undefined} className="text-label text-muted-foreground">
            {emptyText}
          </p>
        )}
        {summary ? null : <MeetingDecisionsBlock meetingId={meetingId} voted={gen.voted} aiDecisions={[]} />}
      </div>
      <SummaryRegenerateConfirm gen={gen} />
    </PanelCard>
  );
}

/**
 * The AI label every generated output carries (PRODUCT.md › Agent Principles):
 * that it is AI, what it was made from, when, and by which model.
 */
function SummaryAttribution({ summary, times }: { summary: MeetingSummary; times: SummarySourceTimes }) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const facts = summarySourceFacts(summary.created_at, times);
  const list = summarySourceList(facts.sources, t, locale);
  // "Made automatically" folds into the source sentence: one AI badge, one line.
  const auto = summary.created_by_kind === "system";
  const source = list
    ? t(auto ? "meetings.summaryAi.autoFrom" : "meetings.summaryAi.sourceFrom", { sources: list })
    : auto
      ? t("meetings.summaryAi.auto")
      : null;

  return (
    <div className="space-y-1">
      <p
        data-testid="ai-attribution"
        // The model is provenance for whoever asks, not a word to read on every visit.
        title={summary.model || undefined}
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground"
      >
        <Badge className="gap-1 bg-brand-subtle text-brand-subtle-foreground">
          <Sparkles aria-hidden />
          {t("meetings.aiLabel")}
        </Badge>
        {source ? (
          <span data-testid={auto ? "ai-summary-auto" : undefined}>
            {source}
            {/* The dot stays at the end of a line, never at the start of the next. */}
            {summary.created_at ? "\u00a0·" : null}
          </span>
        ) : null}
        {summary.created_at ? (
          <time dateTime={summary.created_at} title={formatMeetingStart(summary.created_at, locale)} className="tabular-nums">
            {formatRelativeTime(summary.created_at, locale)}
          </time>
        ) : null}
      </p>
      {facts.stale ? (
        <p data-testid="ai-summary-stale" className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Info aria-hidden className="size-3.5 shrink-0" />
          {t("meetings.summaryStale")}
        </p>
      ) : null}
      {summary.partial ? (
        <p data-testid="ai-summary-partial" className="text-caption text-muted-foreground">
          {t("meetings.summaryPartial")}
        </p>
      ) : null}
    </div>
  );
}
