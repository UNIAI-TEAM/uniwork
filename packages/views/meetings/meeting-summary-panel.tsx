"use client";
import { useId, useState } from "react";
import { ChevronDown, FileHeadphone, RotateCcwClock, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { formatRelativeTime } from "./meeting-relative-time";
import { useOlderTranscript, useRecordings } from "@uniwork/core/meetings";
import { useProject } from "@uniwork/core/tasks";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingSummary } from "@uniwork/core/types/meeting";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingDecisionsBlock } from "./meeting-decisions-block";
import { MeetingFeedLoadOlder } from "./meeting-feed-load-older";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { PanelCard } from "../common/panel-card";
import { MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import { SummaryActionItems } from "./meeting-summary/summary-action-items";
import {
  SummaryGenerateButton,
  SummaryLiveRegion,
  SummaryRegenerateConfirm,
} from "./meeting-summary/summary-generate-controls";
import { summarySourceFacts, summarySourceList, type SummarySourceTimes } from "./meeting-summary/summary-sources";
import { useSummaryGeneration } from "./meeting-summary/use-summary-generation";

const RECORDING_STATUSES = new Set(["ACTIVE", "PROCESSING", "COMPLETE", "FAILED"]);

/**
 * Transcript, AI summary (host generates; everyone reads), action items →
 * tasks, and recordings. Shown once a meeting has started.
 */
export function MeetingSummaryPanel({
  workspaceId,
  meeting,
  canHost,
}: {
  workspaceId: string;
  meeting: Meeting;
  canHost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const meetingId = meeting.id;
  const gen = useSummaryGeneration({ workspaceId, meetingId, canHost });
  const { summary, summaryQuery, transcriptQuery } = gen;
  const olderTranscript = useOlderTranscript(meetingId);
  const transcript = transcriptQuery.data;
  // The empty copy depends on both (no summary → "no transcript yet" or
  // "no summary yet"), so neither is claimed until both have answered.
  const summaryLoading = summaryQuery.isPending || transcriptQuery.isPending;
  const summaryFailed = (summaryQuery.isError && !summary) || (transcriptQuery.isError && !transcript);
  const retrySummary = () => {
    if (summaryQuery.isError) void summaryQuery.refetch();
    if (transcriptQuery.isError) void transcriptQuery.refetch();
  };
  const { data: recordings } = useRecordings(meetingId);
  const [showTranscript, setShowTranscript] = useState(false);
  // A project deleted after the meeting was linked stays on the meeting row
  // (no FK); only a project that still resolves is offered for new tasks.
  const { data: project } = useProject(workspaceId, meeting.project_id || "");
  const [playbackId, setPlaybackId] = useState<string | null>(null);
  const reasonId = useId();

  const actionItems = summary?.action_items ?? [];
  const decisions = summary?.decisions ?? [];
  const transcriptLines = transcript?.length ?? 0;
  const showNeedsSource = gen.showGenerate && !gen.hasSource && !summaryLoading && !summaryFailed;
  // An ended meeting cannot gain a transcript any more: no "turn on captions".
  const transcriptEmpty = meeting.status === "ENDED" ? t("meetings.transcriptEmptyEnded") : t("meetings.transcriptEmpty");

  return (
    <PanelCard
      id="summary-heading"
      icon={Sparkles}
      iconTone="brand"
      tone="brand"
      title={t("meetings.aiSummary")}
      action={
        <SummaryGenerateButton gen={gen} variant="brandSubtle" reasonId={showNeedsSource ? reasonId : undefined} />
      }
    >
      <SummaryLiveRegion message={gen.announcement} />
      <div className="space-y-4" data-testid="meeting-summary-panel">
        {!gen.aiOn && gen.capsLoaded ? (
          <p className="text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
        ) : null}
        {showNeedsSource ? (
          <p id={reasonId} className="text-caption text-muted-foreground">
            {t("meetings.summaryNeedsSource")}
          </p>
        ) : null}

        {summary ? (
          <div className="space-y-4">
            <SummaryAttribution summary={summary} times={gen.sourceTimes} />
            <p className="max-w-prose whitespace-pre-wrap text-pretty text-body text-foreground">{summary.summary}</p>
            <MeetingDecisionsBlock voted={gen.voted} aiDecisions={decisions} />
            {actionItems.length > 0 ? (
              <div>
                <h3 className="mb-2 text-overline text-muted-foreground">{t("meetings.actionItems")}</h3>
                <SummaryActionItems
                  key={summary.id}
                  summary={summary}
                  workspaceId={workspaceId}
                  meetingId={meetingId}
                  canHost={canHost}
                  projectId={project?.id}
                  variant="panel"
                  announce={gen.announce}
                />
              </div>
            ) : null}
          </div>
        ) : summaryLoading ? (
          <MeetingTextSkeleton />
        ) : summaryFailed ? (
          <MeetingSectionError message={t("meetings.summaryLoadFailed")} onRetry={retrySummary} />
        ) : !gen.aiOn && gen.capsLoaded ? null : (
          <p className="text-label text-muted-foreground">
            {gen.hasSource ? t("meetings.summaryEmpty") : transcriptEmpty}
          </p>
        )}
        {summary ? null : <MeetingDecisionsBlock voted={gen.voted} aiDecisions={[]} />}

        <Collapsible open={showTranscript} onOpenChange={setShowTranscript}>
          <CollapsibleTrigger
            render={
              <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground">
                {showTranscript
                  ? t("meetings.hideTranscript")
                  : t(olderTranscript.hasOlder ? "meetings.showTranscriptMore" : "meetings.showTranscript", {
                      count: transcriptLines,
                    })}
                <ChevronDown
                  aria-hidden
                  className={cn("size-3.5 transition-transform duration-standard", showTranscript && "rotate-180")}
                />
              </Button>
            }
          />
          <CollapsibleContent>
            <ol className="mt-2 max-h-80 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-surface-hover p-3" data-testid="meeting-transcript">
              {olderTranscript.hasOlder ? (
                <li>
                  <MeetingFeedLoadOlder
                    label={t("meetings.transcriptLoadOlder")}
                    loading={olderTranscript.isLoadingOlder}
                    onLoad={olderTranscript.loadOlder}
                  />
                </li>
              ) : null}
              {(transcript ?? []).map((s) => (
                <li key={s.id} className="text-body text-foreground">
                  <span className="mr-1 text-caption font-medium text-muted-foreground">{s.speaker_name || "—"}</span>
                  {s.text}
                </li>
              ))}
              {transcriptQuery.isPending ? (
                <li>
                  <MeetingTextSkeleton />
                </li>
              ) : (transcript ?? []).length === 0 && !transcriptQuery.isError ? (
                <li className="text-caption text-muted-foreground">{transcriptEmpty}</li>
              ) : null}
            </ol>
          </CollapsibleContent>
        </Collapsible>

        {(recordings ?? []).length > 0 ? (
          <div>
            <h3 className="mb-2 text-overline text-muted-foreground">
              {t("meetings.recordings")}
            </h3>
            <ul className="space-y-1.5">
              {(recordings ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-body text-foreground">
                  <FileHeadphone aria-hidden className="size-4 shrink-0 text-faint-foreground" />
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {r.started_at ? formatMeetingStart(r.started_at, meetingLocale(i18n.language)) : null}
                  </span>
                  {r.status === "COMPLETE" ? (
                    <Button type="button" size="sm" variant="link" className="h-auto px-0" onClick={() => setPlaybackId(r.id)}>
                      {t("meetings.recording_play")}
                    </Button>
                  ) : RECORDING_STATUSES.has(r.status) ? (
                    <span className="text-caption text-muted-foreground">{t(`meetings.recordingStatus.${r.status}`)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {playbackId ? (
        <MeetingRecordingDialog
          open
          onOpenChange={(open) => {
            if (!open) setPlaybackId(null);
          }}
          meetingId={meetingId}
          recordingId={playbackId}
        />
      ) : null}
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
  const source = list ? t("meetings.summaryAi.sourceFrom", { sources: list }) : null;
  const parts: React.ReactNode[] = [];
  if (source) parts.push(<span key="source">{source}</span>);
  if (summary.created_at) {
    parts.push(
      <time key="time" dateTime={summary.created_at} title={formatMeetingStart(summary.created_at, locale)} className="tabular-nums">
        {formatRelativeTime(summary.created_at, locale)}
      </time>,
    );
  }
  if (summary.model) parts.push(<span key="model">{summary.model}</span>);

  return (
    <div className="space-y-1">
      <p
        data-testid="ai-attribution"
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground"
      >
        <Badge className="gap-1 bg-brand-subtle text-brand-subtle-foreground">
          <Sparkles aria-hidden />
          {t("meetings.aiLabel")}
        </Badge>
        {parts.map((part, i) => (
          <span key={i} className="inline-flex items-center gap-x-1.5">
            {i > 0 ? <span aria-hidden>·</span> : null}
            {part}
          </span>
        ))}
      </p>
      {facts.stale ? (
        <p data-testid="ai-summary-stale" className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <RotateCcwClock aria-hidden className="size-3.5 shrink-0" />
          {t("meetings.summaryStale")}
        </p>
      ) : null}
    </div>
  );
}
