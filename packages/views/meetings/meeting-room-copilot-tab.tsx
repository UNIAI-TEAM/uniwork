"use client";
import { Circle, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage, errorCode } from "@uniwork/core/api/http";
import { buildSummaryTaskItems, previewAssigneeId } from "@uniwork/core/meetings/summary-task-items";
import { useMembers } from "@uniwork/core/workspaces";
import { toastApiError } from "../toast-api-error";
import {
  useAddNote,
  useCreateMeetingSummary,
  useCreateTasksFromSummary,
  useMeetingCapabilities,
  useMeetingSummary,
  useMeetingChat,
  useNotes,
  useRecordings,
  useTranscript,
} from "@uniwork/core/meetings";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@uniwork/ui/components/ui/progress";
import { MeetingCopilotFooter, MeetingCopilotTasksCta } from "./meeting-copilot/meeting-copilot-footer";
import { MeetingCopilotHeader } from "./meeting-copilot/meeting-copilot-header";
import { MeetingActionItemRow } from "./meeting-copilot/meeting-action-item-row";
import { MeetingNotesCard } from "./meeting-copilot/meeting-notes-card";
import { MeetingUnderlineTabs } from "./meeting-underline-tabs";
import { meetingLocale } from "./meeting-datetime";

type CopilotSection = "notes" | "transcript" | "insights" | "actions";

const SECTIONS: CopilotSection[] = ["notes", "transcript", "insights", "actions"];

function useRecordingElapsed(startedAt: string | undefined): string {
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const tick = () => {
      const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      setElapsed(
        [h, m, s].map((part) => String(part).padStart(2, "0")).join(":"),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

export function MeetingRoomCopilotTab({
  workspaceId,
  meetingId,
  canHost,
}: {
  workspaceId?: string;
  meetingId: string;
  canHost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState<CopilotSection>("insights");
  const { data: caps } = useMeetingCapabilities(workspaceId ?? "");
  const { data: summary, isLoading: summaryLoading } = useMeetingSummary(meetingId);
  const { data: transcript } = useTranscript(meetingId);
  const { data: chat } = useMeetingChat(meetingId);
  const { data: notes } = useNotes(meetingId);
  const { data: members } = useMembers(workspaceId ?? "");
  const { data: recordings } = useRecordings(meetingId);
  const generate = useCreateMeetingSummary(meetingId);
  const createTasks = useCreateTasksFromSummary(workspaceId ?? "", meetingId);
  const addNote = useAddNote(meetingId);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<number, string | undefined>>({});
  const [note, setNote] = useState("");

  const memberPreview = useMemo(
    () => (members ?? []).map((m) => ({ user_id: m.user_id, display_name: m.display_name })),
    [members],
  );

  const actionItems = summary?.action_items ?? [];
  const decisions = summary?.decisions ?? [];
  const hasSource = (transcript?.length ?? 0) > 0 || (notes?.length ?? 0) > 0 || (chat?.length ?? 0) > 0;
  const aiOn = caps?.ai_summary === true;
  const activeRecording = (recordings ?? []).find((r) => r.status === "ACTIVE");
  const completedRecording = (recordings ?? []).find((r) => r.file_url);
  const recordingElapsed = useRecordingElapsed(activeRecording?.started_at);
  const progressPct =
    actionItems.length > 0 ? Math.round((picked.size / actionItems.length) * 100) : 0;

  const sectionLabel = (id: CopilotSection) => {
    switch (id) {
      case "notes":
        return t("meetings.notes");
      case "transcript":
        return t("meetings.transcriptTab");
      case "insights":
        return t("meetings.insightsTab");
      case "actions":
        return t("meetings.actionsTab");
    }
  };

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
    if (items.length === 0 || !workspaceId) return;
    createTasks.mutate(items, {
      onSuccess: (ids) => {
        toast.success(t("meetings.tasksCreated", { count: ids.length }));
        setPicked(new Set());
        setAssigneeOverrides({});
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  }

  function assigneePreviewName(index: number, owner?: string) {
    const override = assigneeOverrides[index];
    if (override) {
      return members?.find((m) => m.user_id === override)?.display_name;
    }
    const previewId = previewAssigneeId(owner, memberPreview);
    return previewId ? members?.find((m) => m.user_id === previewId)?.display_name : undefined;
  }

  const summaryUpdatedAt = summary?.created_at
    ? new Date(summary.created_at).toLocaleTimeString(meetingLocale(i18n.language), {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MeetingCopilotHeader
        canHost={canHost}
        aiOn={aiOn}
        hasSource={hasSource}
        hasSummary={Boolean(summary)}
        generating={generate.isPending}
        onGenerate={onGenerate}
      />

      {!aiOn && caps ? (
        <p className="shrink-0 pb-2 text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
      ) : null}

      <MeetingUnderlineTabs
        tabs={SECTIONS}
        value={section}
        onChange={setSection}
        label={sectionLabel}
        spread
        className="mb-2"
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {section === "insights" ? (
          <MeetingNotesCard
            summary={summary?.summary}
            decisions={decisions}
            summaryUpdatedAt={summaryUpdatedAt}
            summarizing={generate.isPending}
            emptyHint={
              summaryLoading
                ? t("common.loading")
                : hasSource
                  ? t("meetings.summaryEmpty")
                  : t("meetings.transcriptEmpty")
            }
          />
        ) : null}

        {section === "notes" ? (
          <section className="flex min-h-0 flex-col gap-3">
            <ul className="min-h-0 space-y-2">
              {(notes ?? []).length === 0 ? (
                <li className="text-label text-muted-foreground">{t("meetings.notesEmpty")}</li>
              ) : (
                (notes ?? []).map((n) => (
                  <li
                    key={n.id}
                    className="rounded-xl border border-border bg-surface-hover/40 p-3"
                  >
                    <div className="mb-1 text-caption text-muted-foreground">
                      {n.display_name ?? n.author_id}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-body text-foreground">{n.body}</div>
                  </li>
                ))
              )}
            </ul>
            <form
              className="flex shrink-0 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addNote.mutate(note, { onSuccess: () => setNote("") });
              }}
            >
              <Input
                className="min-w-0 flex-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("meetings.notesPlaceholder")}
              />
              <Button type="submit" size="sm" disabled={addNote.isPending}>
                {t("common.save")}
              </Button>
            </form>
          </section>
        ) : null}

        {section === "transcript" ? (
          <section>
            <ol className="space-y-2">
              {(transcript ?? []).map((s) => (
                <li key={s.id} className="rounded-lg bg-muted/30 px-2.5 py-2 text-body text-foreground">
                  <span className="text-caption font-medium text-brand">{s.speaker_name || "—"}</span>
                  <span className="text-muted-foreground"> · </span>
                  {s.text}
                </li>
              ))}
              {(transcript ?? []).length === 0 ? (
                <li className="text-label text-muted-foreground">{t("meetings.transcriptEmpty")}</li>
              ) : null}
            </ol>
          </section>
        ) : null}

        {section === "actions" ? (
          <section className="space-y-3">
            <h3 className="text-caption font-medium text-foreground">{t("meetings.actionItems")}</h3>
            {actionItems.length > 0 ? (
              <ul className="space-y-2">
                {actionItems.map((it, i) => (
                  <MeetingActionItemRow
                    key={i}
                    title={it.title}
                    owner={it.owner}
                    due={it.due}
                    selectable={canHost && Boolean(workspaceId)}
                    checked={picked.has(i)}
                    workspaceId={workspaceId}
                    assigneeId={assigneeOverrides[i]}
                    assigneePreviewName={assigneePreviewName(i, it.owner)}
                    onAssigneeChange={
                      canHost && workspaceId
                        ? (userId) => setAssigneeOverrides((prev) => ({ ...prev, [i]: userId }))
                        : undefined
                    }
                    onCheckedChange={(v) =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (v) next.add(i);
                        else next.delete(i);
                        return next;
                      })
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-label text-muted-foreground">{t("meetings.actionItemsEmpty")}</p>
            )}
            <MeetingCopilotTasksCta
              count={picked.size}
              disabled={!canHost || !workspaceId}
              pending={createTasks.isPending}
              onClick={onCreateTasks}
            />
            {actionItems.length > 0 ? (
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-caption font-medium text-foreground">{t("meetings.progressTitle")}</h3>
                  <span className="text-caption tabular-nums text-muted-foreground">{progressPct}%</span>
                </div>
                <Progress value={progressPct} className="gap-0">
                  <ProgressTrack className="h-2 bg-muted">
                    <ProgressIndicator className="bg-success" />
                  </ProgressTrack>
                </Progress>
                <p className="text-caption text-muted-foreground">
                  {t("meetings.progressCompleted", { done: picked.size, total: actionItems.length })}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeRecording ? (
          <section className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-caption font-medium text-destructive">
                <Circle aria-hidden className="size-2 fill-current" />
                {t("meetings.recording")}
              </span>
              <Video aria-hidden className="size-3.5 text-muted-foreground" />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-body text-foreground">{t("meetings.liveRecordingRunning")}</p>
              <p className="mt-1 font-mono text-title-sm tabular-nums text-brand">{recordingElapsed}</p>
            </div>
          </section>
        ) : null}

        {completedRecording?.file_url ? (
          <section className="space-y-2">
            <ButtonLink
              variant="secondary"
              className="w-full"
              href={completedRecording.file_url}
              target="_blank"
              rel="noreferrer"
            >
              {t("meetings.openRecording")}
            </ButtonLink>
          </section>
        ) : null}
      </div>

      <MeetingCopilotFooter />
    </div>
  );
}
