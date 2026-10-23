"use client";
import { useId } from "react";
import { Info, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { meetingDayKey, meetingLocale, meetingShownWindow } from "./meeting-datetime";
import { formatMeetingMoment } from "./meeting-detail-format";
import { formatRelativeTime } from "./meeting-relative-time";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingSummary } from "@uniwork/core/types/meeting";
import { MeetingDecisionsBlock } from "./meeting-decisions-block";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";
import { PanelCard } from "../common/panel-card";
import { MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import { AiBadge } from "./meeting-summary/ai-badge";
import {
  SummaryFailureNotice,
  SummaryGenerateButton,
  SummaryLiveRegion,
  SummaryRegenerateConfirm,
} from "./meeting-summary/summary-generate-controls";
import { summarySourceFacts, summarySourceList, type SummarySourceTimes } from "./meeting-summary/summary-sources";
import { SummaryOpenQuestions, SummaryTopics } from "./meeting-summary/summary-topics";
import { useSummaryGeneration } from "./meeting-summary/use-summary-generation";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

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
  const shownDay = meetingDayKey(meetingShownWindow(meeting, meeting.status === "ENDED").startsAt);
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
    // A neutral card like its siblings: a brand edge read as selected. The AI badge says what made it.
    <PanelCard
      id="summary-heading"
      icon={Sparkles}
      title={t("meetings.summaryTitle")}
      action={
        <SummaryGenerateButton
          gen={gen}
          variant={summary ? "outline" : "default"}
          reasonId={showNeedsSource ? reasonId : undefined}
        />
      }
    >
      <SummaryLiveRegion message={gen.announcement} seq={gen.announcementSeq} />
      <div className="space-y-4" data-testid="meeting-summary-panel">
        <SummaryFailureNotice gen={gen} />
        {summary ? (
          <div className="space-y-4">
            {summary.transcript_changed_at ? (
              // The transcript was corrected, cut or replaced after this summary (UNI-1995 #5).
              <Notice
                tone="info"
                icon={Info}
                layout="inline"
                live="off"
                action={
                  gen.showGenerate ? (
                    <Button type="button" size="sm" variant="outline" onClick={gen.requestGenerate}>
                      {t("meetings.regenerateSummary")}
                    </Button>
                  ) : undefined
                }
              >
                {t("meetings.summaryTranscriptChanged")}
              </Notice>
            ) : null}
            <SummaryAttribution summary={summary} times={gen.sourceTimes} shownDay={shownDay} />
            {gen.serverRunning ? <SummaryRunning /> : null}
            <p className="max-w-prose whitespace-pre-wrap text-pretty text-body text-foreground">{summary.summary}</p>
            <SummaryTopics meetingId={meetingId} topics={summary.topics ?? []} shownDay={shownDay} />
            <MeetingDecisionsBlock meetingId={meetingId} voted={gen.voted} aiDecisions={decisions} />
            <SummaryOpenQuestions meetingId={meetingId} questions={summary.open_questions ?? []} />
          </div>
        ) : summaryQuery.isPending ? (
          <MeetingTextSkeleton />
        ) : gen.generating ? (
          <SummaryRunning skeleton />
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
function SummaryAttribution({
  summary,
  times,
  shownDay,
}: {
  summary: MeetingSummary;
  times: SummarySourceTimes;
  /** The day the hero shows: the tooltip is the clock alone on it, the day too otherwise. */
  shownDay: string;
}) {
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
        <AiBadge />
        {source ? (
          <span data-testid={auto ? "ai-summary-auto" : undefined}>
            {source}
            {/* The dot stays at the end of a line, never at the start of the next. */}
            {summary.created_at ? "\u00a0·" : null}
          </span>
        ) : null}
        {summary.created_at ? (
          <time
            dateTime={summary.created_at}
            title={formatMeetingMoment(summary.created_at, locale, shownDay)}
            className="tabular-nums"
          >
            {formatRelativeTime(summary.created_at, locale, undefined, t("meetings.justNow"))}
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

/**
 * A summary on its way (UNI-1995 #12), for every reader, not only whoever
 * pressed Generate: the line says it, the live region announced it, and the
 * skeleton holds the shape of a summary not there yet. Nothing in it is a
 * status of its own, so it is said once.
 */
function SummaryRunning({ skeleton = false }: { skeleton?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2" data-testid="summary-run-generating">
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Spinner />
        {t("meetings.summaryAi.generatingVisible")}
      </p>
      {skeleton ? (
        <div aria-hidden className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : null}
    </div>
  );
}
