"use client";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toastApiError } from "../toast-api-error";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { useAddNote, useRecordings } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { MeetingAskBox } from "./meeting-copilot/meeting-ask-box";
import { MeetingCatchUpCard } from "./meeting-copilot/meeting-catch-up-card";
import { MeetingCopilotHeader } from "./meeting-copilot/meeting-copilot-header";
import { MeetingActionItemsSection } from "./meeting-action-items/meeting-action-items-section";
import { MeetingCarriedOverSection } from "./meeting-action-items/carried-over-section";
import { MeetingNotesCard } from "./meeting-copilot/meeting-notes-card";
import {
  SummaryFailureNotice,
  SummaryGenerateButton,
  SummaryLiveRegion,
  SummaryRegenerateConfirm,
} from "./meeting-summary/summary-generate-controls";
import { summarySourceFacts, summarySourceList } from "./meeting-summary/summary-sources";
import { useSummaryGeneration } from "./meeting-summary/use-summary-generation";
import { MeetingUnderlineTabBadge, MeetingUnderlineTabs } from "./meeting-underline-tabs";
import { meetingLocale } from "./meeting-datetime";
import { formatMeetingMoment } from "./meeting-detail-format";
import { MeetingRowsSkeleton, MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import { MeetingRoomTranscript } from "./meeting-room-transcript";

export type CopilotSection = "notes" | "transcript" | "insights" | "actions";

// The overview opens first, so it leads the row.
const SECTIONS: CopilotSection[] = ["insights", "notes", "transcript", "actions"];

export function MeetingRoomCopilotTab({
  workspaceId,
  meetingId,
  projectId,
  canClerk,
  lateMinutes,
  onDismissCatchUp,
  scribeOn = false,
  actionsUnseen = 0,
  onSectionChange,
}: {
  workspaceId?: string;
  meetingId: string;
  /** The meeting's project: tasks assigned from the action items start there, as on the detail page. */
  projectId?: string;
  /** Host, secretary or workspace admin. */
  canClerk: boolean;
  /** How late this member joined, when late enough for the catch-up card (B7); guests never get one. */
  lateMinutes?: number | null;
  /** The viewer closed the catch-up card: it stays closed for the meeting, across tab switches. */
  onDismissCatchUp?: () => void;
  /** The AI scribe is in the room, so the transcript fills without anyone turning captions on. */
  scribeOn?: boolean;
  /** Live items the scribe wrote that this viewer has not had on screen (useUnseenLiveItems). */
  actionsUnseen?: number;
  /** Which section is on screen, so the room knows when the live items have been seen. */
  onSectionChange?: (section: CopilotSection) => void;
}) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState<CopilotSection>("insights");
  // Unmounted (another tab), the panel opens on the overview again: say so, or the room keeps "actions".
  useEffect(() => {
    onSectionChange?.(section);
    return () => onSectionChange?.("insights");
  }, [onSectionChange, section]);
  // The clerk's ticks outlive the Actions section, so a look at the
  // transcript does not cost them.
  const actionSelection = useState<ReadonlySet<string>>(() => new Set());
  const gen = useSummaryGeneration({ workspaceId, meetingId, canClerk });
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
  const addNote = useAddNote(meetingId);
  const [note, setNote] = useState("");
  const [playbackId, setPlaybackId] = useState<string | null>(null);

  // The room's notes card shows the decisions only; their evidence is on the detail page.
  const decisions = (summary?.decisions ?? []).map((d) => d.text);
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

  const transcriptEmpty = t(scribeOn ? "meetings.transcriptEmptyScribe" : "meetings.transcriptEmpty");

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

  // The clock alone for today's summary; one made yesterday names its day, as on the detail page.
  const summaryUpdatedAt = summary?.created_at ? formatMeetingMoment(summary.created_at, meetingLocale(i18n.language)) || null : null;

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
      <SummaryLiveRegion message={gen.announcement} seq={gen.announcementSeq} />

      {/* One scroll area: the catch-up, the sections and the Ask box move together, so the box
          sits right under what it answers instead of across an empty band, and nothing is cut off. */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" data-testid="meeting-copilot-scroll">
        {!gen.aiOn && gen.capsLoaded ? (
          <p className="pb-2 text-label text-muted-foreground">{t("meetings.aiUnavailable")}</p>
        ) : null}
        <SummaryFailureNotice gen={gen} className="mb-2" />

        {workspaceId && lateMinutes ? (
          <div className="pb-2">
            <MeetingCatchUpCard meetingId={meetingId} lateMinutes={lateMinutes} onDismiss={onDismissCatchUp} />
          </div>
        ) : null}

        <MeetingUnderlineTabs
          tabs={SECTIONS}
          value={section}
          onChange={setSection}
          label={sectionLabel}
          ariaLabel={t("meetings.copilotSections")}
          panelId={sectionPanelId}
          badge={(id) =>
            id === "actions" && actionsUnseen > 0 ? (
              <MeetingUnderlineTabBadge srLabel={t("meetings.liveItemsUnseen", { count: actionsUnseen })}>
                {actionsUnseen > 9 ? "9+" : actionsUnseen}
              </MeetingUnderlineTabBadge>
            ) : null
          }
          className="sticky top-0 z-10 mb-2 bg-surface"
        />

        <div role="tabpanel" id={sectionPanelId(section)} aria-label={sectionLabel(section)} className="space-y-4">
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
              emptyHint={gen.hasSource ? t("meetings.summaryEmpty") : transcriptEmpty}
            />
          ) : null}

          {section === "notes" ? (
            <section className="flex flex-col gap-3">
              {notesQuery.isPending ? (
                <MeetingRowsSkeleton rows={2} rowClassName="px-0" />
              ) : notesFailed ? (
                <MeetingSectionError message={t("meetings.notesLoadFailed")} onRetry={() => void notesQuery.refetch()} />
              ) : null}
              <ul className="space-y-2">
                {notesQuery.isPending || notesFailed ? null : (notes ?? []).length === 0 ? (
                  <li className="text-label text-muted-foreground">{t("meetings.notesEmpty")}</li>
                ) : (
                  (notes ?? []).map((n) => (
                    <li key={n.id} className="rounded-xl border border-border bg-surface-hover p-3">
                      <div className="mb-1 text-caption text-muted-foreground">{n.display_name || t("meetings.noteAuthorUnknown")}</div>
                      <div className="whitespace-pre-wrap break-words text-body text-foreground">{n.body}</div>
                    </li>
                  ))
                )}
              </ul>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim() || addNote.isPending) return;
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
                {/* Default size: the same height as the field beside it. */}
                <Button type="submit" aria-disabled={addNote.isPending}>
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
              ) : (
                <MeetingRoomTranscript meetingId={meetingId} segments={transcript ?? []} emptyText={transcriptEmpty} />
              )}
            </section>
          ) : null}

          {/* The tab already names this section; no heading repeats it. */}
          {section === "actions" ? (
            <section className="space-y-3">
              {workspaceId ? (
                <>
                  <MeetingActionItemsSection
                    workspaceId={workspaceId}
                    meetingId={meetingId}
                    projectId={projectId}
                    canClerk={canClerk}
                    variant="compact"
                    selection={actionSelection}
                  />
                  {projectId ? (
                    <MeetingCarriedOverSection workspaceId={workspaceId} meetingId={meetingId} variant="compact" />
                  ) : null}
                </>
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

        {/* Not under the notes: that section has its own field, and two inputs read as one form. */}
        {workspaceId && section !== "notes" ? (
          <MeetingAskBox workspaceId={workspaceId} meetingId={meetingId} canShare heading />
        ) : null}
      </div>

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
