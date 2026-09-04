"use client";
import { Circle, Send, Sparkles, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage, errorCode } from "@uniwork/core/api/http";
import { toastApiError } from "../toast-api-error";
import {
  useAddNote,
  useCreateMeetingSummary,
  useCreateTasksFromSummary,
  useMeetingCapabilities,
  useMeetingSummary,
  useNotes,
  useRecordings,
  useTranscript,
} from "@uniwork/core/meetings";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@uniwork/ui/components/ui/progress";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingLocale } from "./meeting-datetime";

type CopilotSection = "summary" | "notes" | "transcript" | "actions";

const SECTIONS: CopilotSection[] = ["summary", "notes", "transcript", "actions"];

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

function summaryLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function SectionPills({
  section,
  onSectionChange,
  label,
}: {
  section: CopilotSection;
  onSectionChange: (section: CopilotSection) => void;
  label: (id: CopilotSection) => string;
}) {
  return (
    <div
      className="flex shrink-0 gap-1.5 overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label={label("summary")}
    >
      {SECTIONS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={section === id}
          className={cn(
            "inline-flex h-8 shrink-0 items-center justify-center rounded-full px-3 text-label whitespace-nowrap transition-colors",
            section === id
              ? "bg-brand font-medium text-brand-foreground"
              : "border border-input bg-surface text-foreground hover:bg-surface-hover dark:bg-secondary",
          )}
          onClick={() => onSectionChange(id)}
        >
          {label(id)}
        </button>
      ))}
    </div>
  );
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
  const [section, setSection] = useState<CopilotSection>("summary");
  const { data: caps } = useMeetingCapabilities(workspaceId ?? "");
  const { data: summary, isLoading: summaryLoading } = useMeetingSummary(meetingId);
  const { data: transcript } = useTranscript(meetingId);
  const { data: notes } = useNotes(meetingId);
  const { data: recordings } = useRecordings(meetingId);
  const generate = useCreateMeetingSummary(meetingId);
  const createTasks = useCreateTasksFromSummary(workspaceId ?? "", meetingId);
  const addNote = useAddNote(meetingId);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");

  const actionItems = summary?.action_items ?? [];
  const decisions = summary?.decisions ?? [];
  const hasSource = (transcript?.length ?? 0) > 0 || (notes?.length ?? 0) > 0;
  const aiOn = caps?.ai_summary === true;
  const activeRecording = (recordings ?? []).find((r) => r.status === "ACTIVE");
  const completedRecording = (recordings ?? []).find((r) => r.file_url);
  const recordingElapsed = useRecordingElapsed(activeRecording?.started_at);
  const progressPct =
    actionItems.length > 0 ? Math.round((picked.size / actionItems.length) * 100) : 0;

  const sectionLabel = (id: CopilotSection) => {
    switch (id) {
      case "summary":
        return t("meetings.summaryTab");
      case "notes":
        return t("meetings.notes");
      case "transcript":
        return t("meetings.transcriptTab");
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
    const items = actionItems
      .filter((_, i) => picked.has(i))
      .map((it) => ({
        title: it.title,
        description: it.owner ? `${t("meetings.owner")}: ${it.owner}` : undefined,
      }));
    if (items.length === 0 || !workspaceId) return;
    createTasks.mutate(items, {
      onSuccess: (ids) => {
        toast.success(t("meetings.tasksCreated", { count: ids.length }));
        setPicked(new Set());
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
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
      <div className="flex shrink-0 items-start justify-between gap-2 pb-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Sparkles aria-hidden className="size-4 shrink-0 text-brand" />
          <h2 className="text-pretty text-title-sm font-semibold text-foreground">
            {t("meetings.aiMeetingAssistant")}
          </h2>
          <Badge
            variant="secondary"
            className="border-brand/20 bg-surface-selected text-brand"
          >
            {t("meetings.betaLabel")}
          </Badge>
        </div>
        {canHost && aiOn ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={generate.isPending || !hasSource}
            onClick={onGenerate}
          >
            {generate.isPending
              ? t("meetings.summarizing")
              : summary
                ? t("meetings.regenerateSummary")
                : t("meetings.generateSummary")}
          </Button>
        ) : null}
      </div>

      {!aiOn && caps ? (
        <p className="shrink-0 pb-2 text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
      ) : null}

      <SectionPills section={section} onSectionChange={setSection} label={sectionLabel} />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {section === "summary" ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-caption font-medium text-foreground">{t("meetings.summaryTab")}</h3>
              {generate.isPending ? (
                <span className="text-caption text-success">{t("meetings.summarizing")}</span>
              ) : summaryUpdatedAt ? (
                <span className="text-caption text-muted-foreground">
                  {t("meetings.summaryUpdated", { time: summaryUpdatedAt })}
                </span>
              ) : null}
            </div>
            {summary ? (
              <ul className="list-disc space-y-1.5 pl-4 text-body text-foreground">
                {summaryLines(summary.summary).map((line, i) => (
                  <li key={i} className="text-pretty">
                    {line}
                  </li>
                ))}
              </ul>
            ) : summaryLoading ? null : (
              <p className="text-label text-muted-foreground">
                {hasSource ? t("meetings.summaryEmpty") : t("meetings.transcriptEmpty")}
              </p>
            )}
            {decisions.length > 0 ? (
              <div className="pt-2">
                <h4 className="mb-1 text-caption font-medium text-foreground">{t("meetings.decisions")}</h4>
                <ul className="list-disc space-y-0.5 pl-4 text-body text-foreground">
                  {decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
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

        {section === "actions" || (section === "summary" && actionItems.length > 0) ? (
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-caption font-medium text-foreground">{t("meetings.actionItems")}</h3>
            {actionItems.length > 0 ? (
              <ul className="space-y-2">
                {actionItems.map((it, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-hover/30 px-3 py-2.5"
                  >
                    {canHost && workspaceId ? (
                      <Checkbox
                        className="mt-0.5"
                        aria-label={it.title}
                        checked={picked.has(i)}
                        onCheckedChange={(v) =>
                          setPicked((s) => {
                            const next = new Set(s);
                            if (v) next.add(i);
                            else next.delete(i);
                            return next;
                          })
                        }
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-body text-foreground">{it.title}</p>
                      {it.owner || it.due ? (
                        <p className="mt-0.5 text-caption text-muted-foreground">
                          {[it.owner, it.due].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-label text-muted-foreground">{t("meetings.actionItemsEmpty")}</p>
            )}
            {canHost && workspaceId && picked.size > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={createTasks.isPending}
                onClick={onCreateTasks}
              >
                {t("meetings.createTasks", { count: picked.size })}
              </Button>
            ) : null}
          </section>
        ) : null}

        {actionItems.length > 0 ? (
          <section className="space-y-2 border-t border-border pt-4">
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
            <a
              href={completedRecording.file_url}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "secondary" }), "w-full")}
            >
              {t("meetings.openRecording")}
            </a>
          </section>
        ) : null}
      </div>

      <div className="mt-3 shrink-0 rounded-xl border border-border bg-muted p-3 dark:border-input dark:bg-secondary">
        <p className="flex items-center gap-1.5 text-label font-medium text-foreground">
          <Sparkles aria-hidden className="size-3.5 text-brand" />
          {t("meetings.askAiCopilot")}
        </p>
        <form
          className="relative mt-2"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <Input
            disabled
            placeholder={t("meetings.askAiCopilotPlaceholder")}
            className="bg-background pr-10 dark:bg-background"
            aria-describedby="copilot-soon-hint"
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="ghost"
            disabled
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
            aria-label={t("meetings.send")}
          >
            <Send aria-hidden className="size-4" />
          </Button>
        </form>
        <p id="copilot-soon-hint" className="mt-1.5 text-caption text-muted-foreground">
          {t("meetings.askAiCopilotSoon")}
        </p>
      </div>
    </div>
  );
}
