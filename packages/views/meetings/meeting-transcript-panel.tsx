"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Ellipsis, FileHeadphone, ScrollText, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCapabilities, useRecordings } from "@uniwork/core/meetings";
import { useMeetingTranscriptions } from "@uniwork/core/meetings/transcriptions";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { useOptionalNavigation } from "../navigation";
import { meetingLocale } from "./meeting-datetime";
import { formatMeetingDayTime } from "./meeting-detail-format";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { MeetingRecordingUploadDialog, MeetingTranscriptionStatus } from "./meeting-recording-upload";
import { MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import { MeetingSpeakerLabelsButton } from "./meeting-speaker-labels-dialog";
import { MeetingTranscriptLines } from "./transcript/meeting-transcript-lines";
import { TranscriptChangeDialog, type TranscriptChange } from "./transcript/transcript-change-dialog";
import { transcriptSpeaker } from "./transcript/transcript-speaker";
import { useTranscriptReader } from "./transcript/use-transcript-reader";

const RECORDING_STATUSES = new Set(["ACTIVE", "PROCESSING", "COMPLETE", "FAILED"]);

/** Anchors other screens land focus on (deep link, "record as held"). */
const TRANSCRIPT_HEADING_ID = "transcript-heading";
const TRANSCRIPT_UPLOAD_ID = "meeting-transcript-upload";

/**
 * Where focus goes once the transcript card changes under a dialog (the
 * meeting recorded as held, a recording queued): its upload button, else its
 * heading.
 */
export function transcriptFocusTarget(): HTMLElement | null {
  const upload = document.getElementById(TRANSCRIPT_UPLOAD_ID);
  if (upload) return upload;
  const heading = document.getElementById(TRANSCRIPT_HEADING_ID);
  // A heading takes programmatic focus only with a tabindex.
  heading?.setAttribute("tabindex", "-1");
  return heading;
}

/**
 * "Transcript": what was said, with when; how to add it (upload a recording
 * of a meeting held without a room, name the speakers) and the room's
 * recordings. Its own card, apart from the summary that reads it.
 */
export function MeetingTranscriptPanel({
  workspaceId,
  meeting,
  canClerk,
}: {
  workspaceId: string;
  meeting: Meeting;
  canClerk: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const meetingId = meeting.id;
  const linked = useTranscriptTarget();
  // The cited line stays marked after the deep link leaves the URL.
  const [target, setTarget] = useState("");
  // A cited line opens the page around it; with none, an ended meeting reads from its start.
  const [around, setAround] = useState("");
  const reader = useTranscriptReader(meetingId, meeting.status === "ENDED" || around !== "", around);
  const recordingsQuery = useRecordings(meetingId);
  const recordings = recordingsQuery.data ?? [];
  const caps = useMeetingCapabilities(workspaceId);
  const canUpload = canClerk && meeting.status === "ENDED" && caps.data?.transcription === true;
  const transcriptions = useMeetingTranscriptions(meetingId).data;
  // A failed upload already says what did not happen and carries the retry:
  // the header button and the empty line would offer the same upload twice more.
  const uploadFailed = transcriptions?.[0]?.status === "FAILED";
  const [showTranscript, setShowTranscript] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [playAt, setPlayAt] = useState<{ recordingId: string; seconds?: number } | null>(null);
  const [change, setChange] = useState<TranscriptChange | null>(null);
  const transcript = reader.rows;
  // The room's lines (scribe, captions) that an upload would replace (UNI-1995 #11).
  const replacesLive = transcript.some((s) => s.source !== "TRANSCRIPTION");
  // The viewer's clock, as every meeting screen reads times (meeting-datetime.ts).
  const clockFormat = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale]);
  const clock = useCallback((iso: string) => {
    const at = Date.parse(iso);
    return Number.isFinite(at) ? clockFormat.format(at) : "";
  }, [clockFormat]);
  const speakerOf = useCallback((s: MeetingTranscriptSegment) => transcriptSpeaker(s, t), [t]);

  // A cited line (?segment=): the transcript opens, on the page that holds it
  // unless that page is loaded already. Only a new link moves the reader.
  const loaded = useRef(transcript);
  loaded.current = transcript;
  useEffect(() => {
    if (!linked) return;
    setTarget(linked);
    setShowTranscript(true);
    if (!loaded.current.some((s) => s.id === linked)) setAround(linked);
  }, [linked]);

  const empty = canUpload
    ? t("meetings.transcriptEmptyUpload")
    : meeting.status === "ENDED"
      ? t("meetings.transcriptEmptyEnded")
      : t("meetings.transcriptEmpty");
  const more = reader.hasOlder || reader.hasNewer;

  return (
    <PanelCard
      id={TRANSCRIPT_HEADING_ID}
      icon={ScrollText}
      title={t("meetings.transcriptTitle")}
      action={
        canUpload && !uploadFailed ? (
          <Button id={TRANSCRIPT_UPLOAD_ID} type="button" size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden />
            {t("meetings.transcription.uploadButton")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4" data-testid="meeting-transcript-panel">
        <MeetingTranscriptionStatus
          meetingId={meetingId}
          onRetry={canUpload ? () => setUploadOpen(true) : undefined}
          canDelete={canClerk}
        />
        {reader.isPending ? (
          <MeetingTextSkeleton />
        ) : reader.isError && transcript.length === 0 ? (
          <MeetingSectionError message={t("meetings.transcriptLoadFailed")} onRetry={reader.refetch} />
        ) : transcript.length === 0 && !more ? (
          uploadFailed ? null : <p className="text-label text-muted-foreground">{target ? t("meetings.transcriptJumpMissing") : empty}</p>
        ) : (
          <Collapsible open={showTranscript} onOpenChange={setShowTranscript}>
            <div className="flex flex-wrap items-center gap-1">
              <CollapsibleTrigger
                render={
                  // An open section is not a pressed button: no fill while expanded.
                  <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground aria-expanded:bg-transparent">
                    {showTranscript
                      ? t("meetings.hideTranscript")
                      : t(more ? "meetings.showTranscriptMore" : "meetings.showTranscript", { count: transcript.length })}
                    <ChevronDown
                      aria-hidden
                      className={cn("transition-transform duration-standard", showTranscript && "rotate-180")}
                    />
                  </Button>
                }
              />
              {canClerk ? <MeetingSpeakerLabelsButton meetingId={meetingId} workspaceId={workspaceId} /> : null}
              {canClerk ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("meetings.transcriptMoreActions")} />}
                  >
                    <Ellipsis aria-hidden className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuItem variant="destructive" onClick={() => setChange({ kind: "all" })}>
                      <Trash2 aria-hidden className="size-4" />
                      {t("meetings.transcriptDeleteAll")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            <CollapsibleContent>
              <MeetingTranscriptLines
                reader={reader}
                recordings={recordings}
                canClerk={canClerk}
                target={target}
                speakerOf={speakerOf}
                clock={clock}
                onPlay={setPlayAt}
                onChange={setChange}
              />
            </CollapsibleContent>
          </Collapsible>
        )}

        {recordings.length > 0 || (recordingsQuery.isError && !recordingsQuery.data) ? (
          <section aria-labelledby="meeting-recordings-heading">
            <h3 id="meeting-recordings-heading" className="mb-2 text-label font-medium text-foreground">
              {t("meetings.recordings")}
            </h3>
            {recordings.length === 0 ? (
              <MeetingSectionError message={t("meetings.recordingsLoadFailed")} onRetry={() => void recordingsQuery.refetch()} />
            ) : null}
            <ul className="space-y-1.5 empty:hidden">
              {recordings.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-body text-foreground">
                  <FileHeadphone aria-hidden className="size-4 shrink-0 text-faint-foreground" />
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {r.started_at ? formatMeetingDayTime(r.started_at, locale) : null}
                  </span>
                  {r.status === "COMPLETE" ? (
                    <Button type="button" size="sm" variant="link" className="h-auto px-0" onClick={() => setPlayAt({ recordingId: r.id })}>
                      {t("meetings.recording_play")}
                    </Button>
                  ) : r.status === "FAILED" ? (
                    <span className="flex items-center gap-1 text-caption text-destructive">
                      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                      {t("meetings.recordingFailed")}
                    </span>
                  ) : RECORDING_STATUSES.has(r.status) ? (
                    <span className="text-caption text-muted-foreground">{t(`meetings.recordingStatus.${r.status}`)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {uploadOpen ? (
        <MeetingRecordingUploadDialog
          meetingId={meetingId}
          onOpenChange={setUploadOpen}
          focusAfterUpload={transcriptFocusTarget}
          replacesLive={replacesLive}
        />
      ) : null}
      {playAt ? (
        <MeetingRecordingDialog
          open
          onOpenChange={(open) => {
            if (!open) setPlayAt(null);
          }}
          meetingId={meetingId}
          recordingId={playAt.recordingId}
          startAt={playAt.seconds}
        />
      ) : null}
      {change ? (
        <TranscriptChangeDialog
          meetingId={meetingId}
          change={change}
          speakerOf={speakerOf}
          clock={clock}
          onClose={() => setChange(null)}
        />
      ) : null}
    </PanelCard>
  );
}

/** The cited line a deep link names (?segment=<id>, with ?section=transcript). */
function useTranscriptTarget(): string {
  return useOptionalNavigation()?.searchParams.get("segment") ?? "";
}
