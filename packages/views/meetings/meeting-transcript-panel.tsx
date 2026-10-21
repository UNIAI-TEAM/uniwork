"use client";
import { useState } from "react";
import { ChevronDown, FileHeadphone, ScrollText, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCapabilities, useOlderTranscript, useRecordings, useTranscript } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { meetingLocale } from "./meeting-datetime";
import { formatMeetingDayTime } from "./meeting-detail-format";
import { MeetingFeedLoadOlder } from "./meeting-feed-load-older";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { MeetingRecordingUploadDialog, MeetingTranscriptionStatus } from "./meeting-recording-upload";
import { MeetingSectionError, MeetingTextSkeleton } from "./meeting-section-state";
import { MeetingSpeakerLabelsButton } from "./meeting-speaker-labels-dialog";

const RECORDING_STATUSES = new Set(["ACTIVE", "PROCESSING", "COMPLETE", "FAILED"]);

/**
 * The name a transcript line shows. A speaker nobody named yet is worded here,
 * in the reader's language: the room mic's "Room mic · Speaker n", an uploaded
 * file's plain "Speaker n" (its label key starts with "upload:").
 */
export function transcriptSpeaker(s: MeetingTranscriptSegment, t: ReturnType<typeof useTranslation>["t"]): string {
  const upload = s.speaker_label?.startsWith("upload:") === true;
  if (s.room_speaker) return t(upload ? "meetings.fileSpeaker" : "meetings.scribe.speakerLabel", { n: s.room_speaker });
  if (s.speaker_label?.endsWith(":?")) return t(upload ? "meetings.fileSpeakerUnknown" : "meetings.scribe.speakerUnknown");
  return s.speaker_name || "—";
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
  const transcriptQuery = useTranscript(meetingId);
  const older = useOlderTranscript(meetingId);
  const { data: recordings } = useRecordings(meetingId);
  const caps = useMeetingCapabilities(workspaceId);
  const canUpload = canClerk && meeting.status === "ENDED" && caps.data?.transcription === true;
  const [showTranscript, setShowTranscript] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [playbackId, setPlaybackId] = useState<string | null>(null);
  const transcript = transcriptQuery.data ?? [];
  // The viewer's clock, as every meeting screen reads times (meeting-datetime.ts).
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const empty = canUpload
    ? t("meetings.transcriptEmptyUpload")
    : meeting.status === "ENDED"
      ? t("meetings.transcriptEmptyEnded")
      : t("meetings.transcriptEmpty");

  return (
    <PanelCard
      id="transcript-heading"
      icon={ScrollText}
      title={t("meetings.transcriptTitle")}
      action={
        canUpload ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden />
            {t("meetings.transcription.uploadButton")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4" data-testid="meeting-transcript-panel">
        <MeetingTranscriptionStatus meetingId={meetingId} onRetry={canUpload ? () => setUploadOpen(true) : undefined} />
        {transcriptQuery.isPending ? (
          <MeetingTextSkeleton />
        ) : transcriptQuery.isError && transcript.length === 0 ? (
          <MeetingSectionError message={t("meetings.transcriptLoadFailed")} onRetry={() => void transcriptQuery.refetch()} />
        ) : transcript.length === 0 && !older.hasOlder ? (
          <p className="text-label text-muted-foreground">{empty}</p>
        ) : (
          <Collapsible open={showTranscript} onOpenChange={setShowTranscript}>
            <div className="flex flex-wrap items-center gap-1">
              <CollapsibleTrigger
                render={
                  // An open section is not a pressed button: no fill while expanded.
                  <Button type="button" size="sm" variant="ghost" className="-ml-2 text-muted-foreground aria-expanded:bg-transparent">
                    {showTranscript
                      ? t("meetings.hideTranscript")
                      : t(older.hasOlder ? "meetings.showTranscriptMore" : "meetings.showTranscript", {
                          count: transcript.length,
                        })}
                    <ChevronDown
                      aria-hidden
                      className={cn("transition-transform duration-standard", showTranscript && "rotate-180")}
                    />
                  </Button>
                }
              />
              {canClerk ? <MeetingSpeakerLabelsButton meetingId={meetingId} workspaceId={workspaceId} /> : null}
            </div>
            <CollapsibleContent>
              {/* Scrolls on its own so a long meeting does not push the page. */}
              <ol
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region takes focus so a keyboard can scroll it (axe scrollable-region-focusable)
                tabIndex={0}
                aria-label={t("meetings.transcriptTitle")}
                className="mt-2 max-h-96 space-y-2 overflow-y-auto rounded-lg border border-border p-3"
                data-testid="meeting-transcript"
              >
                {older.hasOlder ? (
                  <li>
                    <MeetingFeedLoadOlder
                      label={t("meetings.transcriptLoadOlder")}
                      loading={older.isLoadingOlder}
                      onLoad={older.loadOlder}
                    />
                  </li>
                ) : null}
                {transcript.map((s) => {
                  const at = Date.parse(s.spoken_at);
                  return (
                    <li key={s.id} className="text-body text-foreground">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground">
                        <span className="font-medium">{transcriptSpeaker(s, t)}</span>
                        {Number.isFinite(at) ? (
                          <time dateTime={s.spoken_at} className="tabular-nums">
                            {clock.format(at)}
                          </time>
                        ) : null}
                      </p>
                      <p className="text-pretty">{s.text}</p>
                    </li>
                  );
                })}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        )}

        {(recordings ?? []).length > 0 ? (
          <section aria-labelledby="meeting-recordings-heading">
            <h3 id="meeting-recordings-heading" className="mb-2 text-label font-medium text-foreground">
              {t("meetings.recordings")}
            </h3>
            <ul className="space-y-1.5">
              {(recordings ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-body text-foreground">
                  <FileHeadphone aria-hidden className="size-4 shrink-0 text-faint-foreground" />
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {r.started_at ? formatMeetingDayTime(r.started_at, locale) : null}
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
          </section>
        ) : null}
      </div>
      {uploadOpen ? <MeetingRecordingUploadDialog meetingId={meetingId} onOpenChange={setUploadOpen} /> : null}
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
    </PanelCard>
  );
}
