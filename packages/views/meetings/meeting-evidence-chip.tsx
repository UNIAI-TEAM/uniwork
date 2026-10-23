"use client";
import { useState } from "react";
import { Play, Quote, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeeting, useRecordings } from "@uniwork/core/meetings";
import { useMeetingEvidence } from "@uniwork/core/meetings/summary";
import { paths } from "@uniwork/core/paths";
import type { MeetingEvidenceRef } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { useOptionalNavigation } from "../navigation";
import { meetingDayKey, meetingLocale } from "./meeting-datetime";
import { formatMeetingMoment } from "./meeting-detail-format";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { formatOffset, recordingOffset } from "./meeting-recording-offset";
import { MeetingSectionError, MeetingSectionLoading } from "./meeting-section-state";

function kindKey(kind: string): string {
  switch (kind) {
    case "segment":
    case "note":
    case "chat":
      return `meetings.evidence.kind_${kind}`;
    default:
      return "meetings.evidence.kind_other";
  }
}

/**
 * "Evidence" on an AI decision or action item (UNI-2002): the transcript
 * lines, notes and chat messages it rests on, read when the chip opens, and
 * for a spoken line the recording at that moment when there is one. Nothing
 * when the item cites nothing.
 */
export function MeetingEvidenceChip({
  meetingId,
  evidence,
}: {
  meetingId: string;
  evidence: readonly MeetingEvidenceRef[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [playAt, setPlayAt] = useState<{ recordingId: string; seconds: number } | null>(null);
  if (evidence.length === 0) return null;
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={t("meetings.evidence.chipLabel", { count: evidence.length })}
            >
              <Quote aria-hidden />
              {t("meetings.evidence.chip")}
              <span className="tabular-nums">{evidence.length}</span>
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80 space-y-2">
          <h4 className="text-label font-semibold text-foreground">{t("meetings.evidence.title")}</h4>
          {open ? (
            <EvidenceSources
              meetingId={meetingId}
              evidence={evidence}
              onPlay={(at) => {
                setOpen(false);
                setPlayAt(at);
              }}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </PopoverContent>
      </Popover>
      {playAt ? (
        <MeetingRecordingDialog
          open
          onOpenChange={(next) => {
            if (!next) setPlayAt(null);
          }}
          meetingId={meetingId}
          recordingId={playAt.recordingId}
          startAt={playAt.seconds}
        />
      ) : null}
    </>
  );
}

function EvidenceSources({
  meetingId,
  evidence,
  onPlay,
  onClose,
}: {
  meetingId: string;
  evidence: readonly MeetingEvidenceRef[];
  onPlay: (at: { recordingId: string; seconds: number }) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const nav = useOptionalNavigation();
  const workspace = useOptionalWorkspace()?.workspace;
  // "View in transcript" (UNI-1995 #14): the meeting page opens the transcript
  // on the cited line. In the room the panel's navigation opens it in a new tab.
  const meetingPath = workspace ? paths.workspace(workspace.organization_slug, workspace.slug).meeting(meetingId) : null;
  const query = useMeetingEvidence(meetingId, evidence, true);
  const { data: recordings } = useRecordings(meetingId);
  const { data: meeting } = useMeeting(meetingId);
  if (query.isPending) {
    return (
      <MeetingSectionLoading label={t("meetings.evidence.loading")}>
        <Spinner />
      </MeetingSectionLoading>
    );
  }
  if (query.isError) {
    return <MeetingSectionError message={t("meetings.evidence.error")} onRetry={() => void query.refetch()} />;
  }
  if (query.data.length === 0) {
    return <p className="text-caption text-muted-foreground">{t("meetings.evidence.gone")}</p>;
  }
  // The viewer's clock, as every meeting screen reads times; a line past the meeting's own day names its day.
  const locale = meetingLocale(i18n.language);
  const meetingDay = meeting ? meetingDayKey(meeting.actual_start_at ?? meeting.starts_at) : undefined;
  return (
    <ul className="max-h-80 space-y-3 overflow-y-auto">
      {query.data.map((src) => {
        const at = Date.parse(src.at ?? "");
        const play = src.kind === "segment" ? recordingOffset(src.at, recordings ?? []) : null;
        return (
          <li key={`${src.kind}:${src.id}`} className="space-y-1">
            <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
              <span className="font-medium text-foreground">{src.author || "—"}</span>
              <span aria-hidden>·</span>
              <span>{t(kindKey(src.kind))}</span>
              {Number.isFinite(at) ? (
                <>
                  <span aria-hidden>·</span>
                  <time dateTime={src.at ?? undefined} className="tabular-nums">
                    {formatMeetingMoment(src.at, locale, meetingDay)}
                  </time>
                </>
              ) : null}
            </p>
            {/* Whole, not clamped: the list scrolls, and a cut quote cannot be opened any further. */}
            <p className="whitespace-pre-wrap text-pretty text-body text-foreground">{src.text}</p>
            <div className="flex flex-wrap gap-x-3 empty:hidden">
              {play ? (
                <Button type="button" size="xs" variant="link" className="h-auto px-0" onClick={() => onPlay(play)}>
                  <Play aria-hidden />
                  {t("meetings.evidence.openRecording", { time: formatOffset(play.seconds) })}
                </Button>
              ) : null}
              {src.kind === "segment" && nav && meetingPath ? (
                <Button
                  type="button"
                  size="xs"
                  variant="link"
                  className="h-auto px-0"
                  onClick={() => {
                    onClose();
                    nav.push(`${meetingPath}?section=transcript&segment=${encodeURIComponent(src.id)}`);
                  }}
                >
                  <ScrollText aria-hidden />
                  {t("meetings.evidence.viewInTranscript")}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
