"use client";
import { useState } from "react";
import { CalendarPlus, CheckCircle2, ChevronDown, FileAudio, ListChecks, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage, errorCode } from "@uniwork/core/api/http";
import { toastApiError } from "../toast-api-error";
import { meetingLocale } from "./meeting-datetime";
import {
  useCreateMeetingSummary,
  useCreateTasksFromSummary,
  useMeetingCalendar,
  useMeetingCapabilities,
  useMeetingSummary,
  useRecordings,
  useTranscript,
} from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPanelCard } from "./meeting-panel-card";

/** Browser download of an .ics the API already authenticated for us. */
function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function MeetingCalendarButton({ meetingId, className }: { meetingId: string; className?: string }) {
  const { t } = useTranslation();
  const cal = useMeetingCalendar();
  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      disabled={cal.isPending}
      onClick={() =>
        cal.mutate(meetingId, {
          onSuccess: (ics) => downloadText(`meeting-${meetingId}.ics`, ics),
          onError: (err) => toastApiError(err, t("common.error")),
        })
      }
    >
      <CalendarPlus aria-hidden className="size-4" />
      {t("meetings.addToCalendar")}
    </Button>
  );
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
  const { data: summary, isLoading: summaryLoading } = useMeetingSummary(meetingId);
  const { data: transcript } = useTranscript(meetingId);
  const { data: recordings } = useRecordings(meetingId);
  const generate = useCreateMeetingSummary(meetingId);
  const createTasks = useCreateTasksFromSummary(workspaceId, meetingId);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [showTranscript, setShowTranscript] = useState(false);

  const actionItems = summary?.action_items ?? [];
  const decisions = summary?.decisions ?? [];
  const hasSource = (transcript?.length ?? 0) > 0;
  const aiOn = caps?.ai_summary === true;

  function onGenerate() {
    generate.mutate(i18n.language.startsWith("en") ? "en" : "vi", {
      onSuccess: () => setPicked(new Set()),
      onError: (err) => {
        const code = errorCode(err);
        toast.error(
          code === "nothing_to_summarize"
            ? t("meetings.summaryNothing")
            : code === "ai_not_configured"
              ? t("meetings.aiUnavailable")
              : apiErrorMessage(err) ?? t("common.error"),
        );
      },
    });
  }

  function onCreateTasks() {
    const items = actionItems.filter((_, i) => picked.has(i)).map((it) => ({ title: it.title, description: it.owner ? `${t("meetings.owner")}: ${it.owner}` : undefined }));
    if (items.length === 0) return;
    createTasks.mutate(items, {
      onSuccess: (ids) => {
        toast.success(t("meetings.tasksCreated", { count: ids.length }));
        setPicked(new Set());
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  }

  return (
    <MeetingPanelCard
      id="summary-heading"
      icon={Sparkles}
      tone="brand"
      title={t("meetings.aiSummary")}
      action={
        canHost && aiOn ? (
          <Button type="button" size="sm" variant="brandSubtle" disabled={generate.isPending || !hasSource} onClick={onGenerate}>
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

        {summary ? (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap text-pretty text-body-lg leading-relaxed text-foreground">{summary.summary}</p>
            {decisions.length > 0 ? (
              <div>
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
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
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("meetings.actionItems")}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {actionItems.map((it, i) => (
                    <li
                      key={i}
                      className={cn(
                        "flex items-start gap-3 px-3 py-2.5 text-body text-foreground transition-colors",
                        picked.has(i) && "bg-surface-selected",
                      )}
                    >
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
                      </span>
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
            {summary.model ? (
              <p className="text-caption text-muted-foreground">{t("meetings.summaryBy", { model: summary.model })}</p>
            ) : null}
          </div>
        ) : summaryLoading ? null : (
          <p className="text-label text-muted-foreground">
            {hasSource ? t("meetings.summaryEmpty") : t("meetings.transcriptEmpty")}
          </p>
        )}

        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-label text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showTranscript}
            onClick={() => setShowTranscript((v) => !v)}
          >
            {showTranscript
              ? t("meetings.hideTranscript")
              : t("meetings.showTranscript", { count: transcript?.length ?? 0 })}
            <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-200", showTranscript && "rotate-180")} />
          </button>
          {showTranscript ? (
            <ol className="mt-2 max-h-80 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-surface-hover/40 p-3" data-testid="meeting-transcript">
              {(transcript ?? []).map((s) => (
                <li key={s.id} className="text-body text-foreground">
                  <span className="mr-1 text-caption font-medium text-muted-foreground">{s.speaker_name || "—"}</span>
                  {s.text}
                </li>
              ))}
              {(transcript ?? []).length === 0 ? (
                <li className="text-caption text-muted-foreground">{t("meetings.transcriptEmpty")}</li>
              ) : null}
            </ol>
          ) : null}
        </div>

        {(recordings ?? []).length > 0 ? (
          <div>
            <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
              {t("meetings.recordings")}
            </h3>
            <ul className="space-y-1.5">
              {(recordings ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-body text-foreground">
                  <FileAudio aria-hidden className="size-4 shrink-0 text-faint-foreground" />
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {r.started_at
                      ? new Date(r.started_at).toLocaleString(meetingLocale(i18n.language), { dateStyle: "short", timeStyle: "short" })
                      : null}
                  </span>
                  {r.file_url ? (
                    <a href={r.file_url} target="_blank" rel="noreferrer" className="text-brand underline-offset-4 hover:underline">
                      {t("meetings.openRecording")}
                    </a>
                  ) : (
                    <span className="text-caption text-muted-foreground">{t(`meetings.recordingStatus.${r.status}`, { defaultValue: r.status })}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </MeetingPanelCard>
  );
}
