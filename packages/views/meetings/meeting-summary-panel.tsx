"use client";
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, FileAudio, History, ListChecks, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import { buildSummaryTaskItems, previewAssigneeId } from "@uniwork/core/meetings/summary-task-items";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
import { formatMeetingStart, meetingLocale } from "./meeting-datetime";
import { formatRelativeTime } from "./meeting-relative-time";
import {
  useCreateMeetingSummary,
  useCreateTasksFromSummary,
  useMeetingCapabilities,
  useMeetingSummary,
  useNotes,
  useRecordings,
  useTranscript,
} from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingNote, MeetingSummary, MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingAssigneeSelect } from "./meeting-assignee-select";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { PanelCard } from "../common/panel-card";
import { MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import { useMemberIndex } from "./use-member-index";

const RECORDING_STATUSES = new Set(["ACTIVE", "PROCESSING", "COMPLETE", "FAILED"]);

/**
 * What the summary can truthfully say about its inputs. The server keeps no
 * snapshot of what it read, so the kind is judged from what existed when it
 * was generated (by timestamp), and anything newer marks the summary stale.
 */
export function summarySourceFacts(
  generatedAt: string | undefined,
  transcript: MeetingTranscriptSegment[],
  notes: MeetingNote[],
): { kind: "both" | "transcript" | "notes" | null; stale: boolean } {
  const at = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  if (!Number.isFinite(at)) return { kind: null, stale: false };
  const before = (iso?: string | null) => {
    const ms = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(ms) && ms <= at;
  };
  const after = (iso?: string | null) => {
    const ms = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(ms) && ms > at;
  };
  const hadTranscript = transcript.some((s) => before(s.spoken_at));
  const hadNotes = notes.some((n) => before(n.created_at));
  const kind = hadTranscript && hadNotes ? "both" : hadTranscript ? "transcript" : hadNotes ? "notes" : null;
  const stale = transcript.some((s) => after(s.spoken_at)) || notes.some((n) => after(n.created_at));
  return { kind, stale };
}

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
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const summaryQuery = useMeetingSummary(meetingId);
  const transcriptQuery = useTranscript(meetingId);
  const summary = summaryQuery.data;
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
  const generate = useCreateMeetingSummary(meetingId);
  const createTasks = useCreateTasksFromSummary(workspaceId, meetingId);
  const { memberOf, members } = useMemberIndex(workspaceId);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<number, string | undefined>>({});
  const [showTranscript, setShowTranscript] = useState(false);
  const { data: notes } = useNotes(meetingId);
  const [playbackId, setPlaybackId] = useState<string | null>(null);

  const memberPreview = useMemo(
    () => members.map((m) => ({ user_id: m.user_id, display_name: m.display_name })),
    [members],
  );

  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const actionItems = summary?.action_items ?? [];
  const decisions = summary?.decisions ?? [];
  const transcriptLines = transcript?.length ?? 0;
  const noteCount = notes?.length ?? 0;
  // The server summarises the transcript and the notes, so either one is enough.
  const hasSource = transcriptLines > 0 || noteCount > 0;
  const aiOn = caps?.ai_summary === true;
  const showGenerate = canHost && aiOn;

  function onGenerate() {
    generate.mutate(i18n.language.startsWith("en") ? "en" : "vi", {
      onSuccess: () => {
        setPicked(new Set());
        setConfirmRegenerate(false);
      },
      onError: (err) => {
        const code = errorCode(err);
        if (code === "nothing_to_summarize") toast.error(t("meetings.summaryNothing"));
        else if (code === "ai_not_configured") toast.error(t("meetings.aiUnavailable"));
        else toastApiError(err, t("common.error"));
      },
    });
  }

  function onCreateTasks() {
    const items = buildSummaryTaskItems(actionItems, picked, assigneeOverrides);
    if (items.length === 0) return;
    createTasks.mutate(items, {
      onSuccess: (ids) => {
        toast.success(t("meetings.tasksCreated", { count: ids.length }));
        setPicked(new Set());
        setAssigneeOverrides({});
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  }

  function assigneeLabel(index: number, owner?: string) {
    const override = assigneeOverrides[index];
    if (override) return memberOf(override)?.display_name;
    return memberOf(previewAssigneeId(owner, memberPreview))?.display_name;
  }

  return (
    <PanelCard
      id="summary-heading"
      icon={Sparkles}
      iconTone="brand"
      tone="brand"
      title={t("meetings.aiSummary")}
      action={
        showGenerate ? (
          <Button
            type="button"
            size="sm"
            variant="brandSubtle"
            disabled={generate.isPending || !hasSource}
            aria-describedby={!hasSource && !summaryLoading ? "summary-needs-source" : undefined}
            onClick={() => (summary ? setConfirmRegenerate(true) : onGenerate())}
          >
            <Sparkles aria-hidden />
            {generate.isPending
              ? t("meetings.summarizing")
              : summary
                ? t("meetings.regenerateSummary")
                : t("meetings.generateSummary")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4" data-testid="meeting-summary-panel">
        {!aiOn && caps ? (
          <p className="text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
        ) : null}
        {showGenerate && !hasSource && !summaryLoading && !summaryFailed ? (
          <p id="summary-needs-source" className="text-caption text-muted-foreground">
            {t("meetings.summaryNeedsSource")}
          </p>
        ) : null}

        {summary ? (
          <div className="space-y-4">
            <SummaryAttribution summary={summary} transcript={transcript ?? []} notes={notes ?? []} />
            <p className="max-w-prose whitespace-pre-wrap text-pretty text-body text-foreground">{summary.summary}</p>
            {decisions.length > 0 ? (
              <div>
                <h3 className="mb-2 text-overline text-muted-foreground">
                  {t("meetings.decisions")}
                </h3>
                <ul className="space-y-1.5">
                  {decisions.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-body text-foreground">
                      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                      <span className="min-w-0">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {actionItems.length > 0 ? (
              <div>
                <h3 className="mb-2 text-overline text-muted-foreground">
                  {t("meetings.actionItems")}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {actionItems.map((it, i) => (
                    <li
                      key={i}
                      className={cn(
                        "space-y-1.5 px-3 py-2.5 text-body text-foreground transition-colors",
                        picked.has(i) && "bg-surface-selected",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {canHost ? (
                          <Checkbox
                            aria-label={it.title}
                            className="mt-0.5"
                            checked={picked.has(i)}
                            onCheckedChange={(v) =>
                              setPicked((s) => {
                                const n = new Set(s);
                                if (v) n.add(i);
                                else n.delete(i);
                                return n;
                              })
                            }
                          />
                        ) : null}
                        <span className="min-w-0 flex-1">
                          {it.title}
                          {it.owner || it.due ? (
                            <span className="ml-1.5 text-caption text-muted-foreground">
                              {[it.owner, it.due].filter(Boolean).join(" · ")}
                            </span>
                          ) : null}
                          {canHost && assigneeLabel(i, it.owner) ? (
                            <span className="ml-1.5 text-caption text-brand">
                              <span aria-hidden>→ </span>
                              <span className="sr-only">{t("meetings.assignedTo")} </span>
                              {assigneeLabel(i, it.owner)}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      {canHost && picked.has(i) ? (
                        <MeetingAssigneeSelect
                          workspaceId={workspaceId}
                          value={assigneeOverrides[i]}
                          suggestedOwner={it.owner}
                          onChange={(userId) =>
                            setAssigneeOverrides((prev) => ({ ...prev, [i]: userId }))
                          }
                          className="ml-7 h-8 max-w-xs"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canHost ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2.5"
                    disabled={picked.size === 0 || createTasks.isPending}
                    onClick={onCreateTasks}
                  >
                    <ListChecks aria-hidden className="size-4" />
                    {t("meetings.createTasks", { count: picked.size })}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : summaryLoading ? (
          <MeetingTextSkeleton />
        ) : summaryFailed ? (
          <MeetingSectionError message={t("meetings.summaryLoadFailed")} onRetry={retrySummary} />
        ) : !aiOn && caps ? null : (
          <p className="text-label text-muted-foreground">
            {hasSource ? t("meetings.summaryEmpty") : t("meetings.transcriptEmpty")}
          </p>
        )}

        <Collapsible open={showTranscript} onOpenChange={setShowTranscript}>
          <CollapsibleTrigger
            render={
              <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground">
                {showTranscript
                  ? t("meetings.hideTranscript")
                  : t("meetings.showTranscript", { count: transcriptLines })}
                <ChevronDown
                  aria-hidden
                  className={cn("size-3.5 transition-transform duration-standard", showTranscript && "rotate-180")}
                />
              </Button>
            }
          />
          <CollapsibleContent>
            <ol className="mt-2 max-h-80 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-surface-hover p-3" data-testid="meeting-transcript">
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
                <li className="text-caption text-muted-foreground">{t("meetings.transcriptEmpty")}</li>
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
                  <FileAudio aria-hidden className="size-4 shrink-0 text-faint-foreground" />
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {r.started_at ? formatMeetingStart(r.started_at, meetingLocale(i18n.language)) : null}
                  </span>
                  {r.file_url ? (
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
      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title={t("meetings.regenerateSummaryTitle")}
        description={t("meetings.regenerateSummaryHint")}
        confirmLabel={t("meetings.regenerateSummaryConfirm")}
        pending={generate.isPending}
        onConfirm={onGenerate}
      />
    </PanelCard>
  );
}

/**
 * The AI label every generated output carries (PRODUCT.md › Agent Principles):
 * that it is AI, what it was made from, when, and by which model.
 */
function SummaryAttribution({
  summary,
  transcript,
  notes,
}: {
  summary: MeetingSummary;
  transcript: MeetingTranscriptSegment[];
  notes: MeetingNote[];
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const facts = summarySourceFacts(summary.created_at, transcript, notes);
  const source =
    facts.kind === "both"
      ? t("meetings.summarySourceKindBoth")
      : facts.kind === "transcript"
        ? t("meetings.summarySourceKindTranscript")
        : facts.kind === "notes"
          ? t("meetings.summarySourceNotes")
          : null;
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
          <History aria-hidden className="size-3.5 shrink-0" />
          {t("meetings.summaryStale")}
        </p>
      ) : null}
    </div>
  );
}
