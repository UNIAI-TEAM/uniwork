"use client";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toastApiError } from "../toast-api-error";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { useAddNote, useRecordings } from "@uniwork/core/meetings";
import { useProject } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { MeetingCopilotFooter } from "./meeting-copilot/meeting-copilot-footer";
import { MeetingCopilotHeader } from "./meeting-copilot/meeting-copilot-header";
import { MeetingNotesCard, MeetingSummaryAttribution } from "./meeting-copilot/meeting-notes-card";
import { SummaryActionItems } from "./meeting-summary/summary-action-items";
import {
  SummaryGenerateButton,
  SummaryLiveRegion,
  SummaryRegenerateConfirm,
} from "./meeting-summary/summary-generate-controls";
import { summarySourceFacts, summarySourceList } from "./meeting-summary/summary-sources";
import { useSummaryGeneration } from "./meeting-summary/use-summary-generation";
import { MeetingUnderlineTabs } from "./meeting-underline-tabs";
import { meetingLocale } from "./meeting-datetime";
import { MeetingRowsSkeleton, MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";

type CopilotSection = "notes" | "transcript" | "insights" | "actions";

const SECTIONS: CopilotSection[] = ["notes", "transcript", "insights", "actions"];

export function MeetingRoomCopilotTab({
  workspaceId,
  meetingId,
  projectId,
  canHost,
}: {
  workspaceId?: string;
  meetingId: string;
  /** The meeting's project: tasks created from the summary start there, as on the detail page. */
  projectId?: string;
  canHost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState<CopilotSection>("insights");
  const gen = useSummaryGeneration({ workspaceId, meetingId, canHost });
  const { summary, summaryQuery, transcriptQuery, chatQuery, notesQuery } = gen;
  const transcript = transcriptQuery.data;
  const notes = notesQuery.data;
  const transcriptFailed = transcriptQuery.isError && !transcript;
  const notesFailed = notesQuery.isError && !notes;
  // The overview's empty copy reads every source, so it waits for all of them.
  const sources = [summaryQuery, transcriptQuery, chatQuery, notesQuery];
  const insightsLoading = sources.some((q) => q.isPending);
  const insightsFailed = sources.some((q) => q.isError && !q.data);
  const retryInsights = () => {
    for (const q of sources) if (q.isError) void q.refetch();
  };
  const { data: recordings } = useRecordings(meetingId);
  // Only a project that still resolves is offered for new tasks (no FK on the meeting row).
  const { data: project } = useProject(workspaceId ?? "", projectId ?? "");
  const addNote = useAddNote(meetingId);
  const [note, setNote] = useState("");
  const [playbackId, setPlaybackId] = useState<string | null>(null);

  const actionItems = summary?.action_items ?? [];
  const decisions = summary?.decisions ?? [];
  // The live recording state is the stage header's REC badge; this panel
  // only offers a finished recording to play back.
  const completedRecording = (recordings ?? []).find((r) => r.status === "COMPLETE");
  const panelBaseId = useId();
  const generateReasonId = useId();
  const sectionPanelId = (id: CopilotSection) => `${panelBaseId}-section-${id}`;
  const summarySources = summary
    ? summarySourceList(
        summarySourceFacts(summary.created_at, gen.sourceTimes).sources,
        t,
        meetingLocale(i18n.language),
      )
    : null;

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

  // Date and time: a summary made yesterday must not read as made today.
  const summaryUpdatedAt = summary?.created_at
    ? new Date(summary.created_at).toLocaleString(meetingLocale(i18n.language), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MeetingCopilotHeader
        action={
          <SummaryGenerateButton
            gen={gen}
            variant="outline"
            className="shrink-0"
            reasonId={gen.blockedReason ? generateReasonId : undefined}
          />
        }
      />
      {gen.showGenerate && gen.blockedReason ? (
        <p id={generateReasonId} className="sr-only">
          {gen.blockedReason}
        </p>
      ) : null}
      <SummaryLiveRegion message={gen.announcement} />

      {!gen.aiOn && gen.capsLoaded ? (
        <p className="shrink-0 pb-2 text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
      ) : null}

      <MeetingUnderlineTabs
        tabs={SECTIONS}
        value={section}
        onChange={setSection}
        label={sectionLabel}
        panelId={sectionPanelId}
        className="mb-2"
      />

      <div
        role="tabpanel"
        id={sectionPanelId(section)}
        aria-label={sectionLabel(section)}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5"
      >
        {section === "insights" && !summary && insightsLoading ? (
          <MeetingTextSkeleton className="rounded-xl border border-border p-4" />
        ) : section === "insights" && !summary && insightsFailed ? (
          <MeetingSectionError message={t("meetings.summaryLoadFailed")} onRetry={retryInsights} />
        ) : section === "insights" ? (
          <MeetingNotesCard
            summary={summary?.summary}
            decisions={decisions}
            summaryUpdatedAt={summaryUpdatedAt}
            summaryModel={summary?.model}
            summarySources={summarySources}
            summarizing={gen.generating}
            emptyHint={gen.hasSource ? t("meetings.summaryEmpty") : t("meetings.transcriptEmpty")}
          />
        ) : null}

        {section === "notes" ? (
          <section className="flex min-h-0 flex-col gap-3">
            {notesQuery.isPending ? (
              <MeetingRowsSkeleton rows={2} rowClassName="px-0" />
            ) : notesFailed ? (
              <MeetingSectionError message={t("meetings.notesLoadFailed")} onRetry={() => void notesQuery.refetch()} />
            ) : null}
            <ul className="min-h-0 space-y-2">
              {notesQuery.isPending || notesFailed ? null : (notes ?? []).length === 0 ? (
                <li className="text-label text-muted-foreground">{t("meetings.notesEmpty")}</li>
              ) : (
                (notes ?? []).map((n) => (
                  <li
                    key={n.id}
                    className="rounded-xl border border-border bg-surface-hover p-3"
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
                if (!note.trim()) return;
                addNote.mutate(note, {
                  onSuccess: () => setNote(""),
                  onError: (err) => toastApiError(err, t("meetings.noteAddFailed")),
                });
              }}
            >
              <Input
                className="min-w-0 flex-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("meetings.notesPlaceholder")}
                aria-label={t("meetings.notesInputLabel")}
              />
              <Button type="submit" size="sm" disabled={addNote.isPending}>
                {t("common.save")}
              </Button>
            </form>
          </section>
        ) : null}

        {section === "transcript" ? (
          <section>
            {transcriptQuery.isPending ? (
              <MeetingTextSkeleton />
            ) : transcriptFailed ? (
              <MeetingSectionError
                message={t("meetings.transcriptLoadFailed")}
                onRetry={() => void transcriptQuery.refetch()}
              />
            ) : null}
            <ol className="space-y-2">
              {(transcript ?? []).map((s) => (
                <li key={s.id} className="rounded-lg bg-surface-hover px-2.5 py-2 text-body text-foreground">
                  <span className="text-caption font-medium text-brand">{s.speaker_name || "—"}</span>
                  <span className="text-muted-foreground"> · </span>
                  {s.text}
                </li>
              ))}
              {(transcript ?? []).length === 0 && !transcriptQuery.isPending && !transcriptFailed ? (
                <li className="text-label text-muted-foreground">{t("meetings.transcriptEmpty")}</li>
              ) : null}
            </ol>
          </section>
        ) : null}

        {section === "actions" ? (
          <section className="space-y-3">
            <h3 className="text-caption font-medium text-foreground">{t("meetings.actionItems")}</h3>
            {actionItems.length > 0 && summaryUpdatedAt ? (
              <MeetingSummaryAttribution model={summary?.model} time={summaryUpdatedAt} sources={summarySources} />
            ) : null}
            {summary && actionItems.length > 0 ? (
              <SummaryActionItems
                key={summary.id}
                summary={summary}
                workspaceId={workspaceId}
                meetingId={meetingId}
                canHost={canHost}
                projectId={project?.id}
                variant="copilot"
                announce={gen.announce}
              />
            ) : (
              <p className="text-label text-muted-foreground">{t("meetings.actionItemsEmpty")}</p>
            )}
          </section>
        ) : null}

        {completedRecording ? (
          <section className="space-y-2">
            <Button type="button" variant="secondary" className="w-full" onClick={() => setPlaybackId(completedRecording.id)}>
              {t("meetings.recording_play")}
            </Button>
          </section>
        ) : null}
      </div>

      <MeetingCopilotFooter />
      <SummaryRegenerateConfirm gen={gen} />
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
    </div>
  );
}
