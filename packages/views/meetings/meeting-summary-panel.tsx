"use client";
import { useMemo, useState } from "react";
import { CalendarPlus, ListChecks, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage, errorCode } from "@uniwork/core/api/http";
import { buildSummaryTaskItems, previewAssigneeId } from "@uniwork/core/meetings/summary-task-items";
import { useMembers } from "@uniwork/core/workspaces";
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
import { MeetingAssigneeSelect } from "./meeting-assignee-select";

/** Browser download of an .ics the API already authenticated for us. */
function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function MeetingCalendarButton({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const cal = useMeetingCalendar();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
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
  const { data: members } = useMembers(workspaceId);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<number, string | undefined>>({});
  const [showTranscript, setShowTranscript] = useState(false);

  const memberPreview = useMemo(
    () => (members ?? []).map((m) => ({ user_id: m.user_id, display_name: m.display_name })),
    [members],
  );

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
    if (override) {
      return members?.find((m) => m.user_id === override)?.display_name;
    }
    const previewId = previewAssigneeId(owner, memberPreview);
    return previewId ? members?.find((m) => m.user_id === previewId)?.display_name : undefined;
  }

  return (
    <section className="space-y-4" data-testid="meeting-summary-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-body font-semibold text-foreground">
          <Sparkles aria-hidden className="size-4 text-brand" />
          {t("meetings.aiSummary")}
        </h2>
        {canHost && aiOn ? (
          <Button type="button" size="sm" disabled={generate.isPending || !hasSource} onClick={onGenerate}>
            {generate.isPending
              ? t("meetings.summarizing")
              : summary
                ? t("meetings.regenerateSummary")
                : t("meetings.generateSummary")}
          </Button>
        ) : null}
      </div>

      {!aiOn && caps ? (
        <p className="text-caption text-muted-foreground">{t("meetings.aiUnavailable")}</p>
      ) : null}

      {summary ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="whitespace-pre-wrap text-pretty text-body text-foreground">{summary.summary}</p>
          {decisions.length > 0 ? (
            <div>
              <h3 className="mb-1 text-label font-medium text-foreground">{t("meetings.decisions")}</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-body text-foreground">
                {decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {actionItems.length > 0 ? (
            <div>
              <h3 className="mb-1 text-label font-medium text-foreground">{t("meetings.actionItems")}</h3>
              <ul className="space-y-1.5">
                {actionItems.map((it, i) => (
                  <li key={i} className="space-y-1.5 text-body text-foreground">
                    <div className="flex items-start gap-2">
                      {canHost ? (
                        <Checkbox
                          aria-label={it.title}
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
                          <span className="ml-1 text-caption text-muted-foreground">
                            {[it.owner, it.due].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                        {canHost && assigneeLabel(i, it.owner) ? (
                          <span className="ml-1 text-caption text-brand">
                            → {assigneeLabel(i, it.owner)}
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
                        className="ml-6 h-8 max-w-xs"
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
                  className="mt-2"
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
        <p className="text-caption text-muted-foreground">
          {hasSource ? t("meetings.summaryEmpty") : t("meetings.transcriptEmpty")}
        </p>
      )}

      <div>
        <button
          type="button"
          className="text-label text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setShowTranscript((v) => !v)}
        >
          {showTranscript
            ? t("meetings.hideTranscript")
            : t("meetings.showTranscript", { count: transcript?.length ?? 0 })}
        </button>
        {showTranscript ? (
          <ol className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-3" data-testid="meeting-transcript">
            {(transcript ?? []).map((s) => (
              <li key={s.id} className="text-body text-foreground">
                <span className="text-caption text-muted-foreground">{s.speaker_name || "—"}: </span>
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
          <h3 className="mb-1 text-label font-medium text-foreground">{t("meetings.recordings")}</h3>
          <ul className="space-y-1">
            {(recordings ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-body text-foreground">
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
    </section>
  );
}
