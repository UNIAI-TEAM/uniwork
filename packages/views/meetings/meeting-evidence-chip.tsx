"use client";
import { useState, type ReactNode } from "react";
import { Play, Quote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeeting, useRecordings } from "@uniwork/core/meetings";
import { useMeetingEvidence } from "@uniwork/core/meetings/summary";
import type { MeetingEvidenceRef, MeetingRecording } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { meetingDayKey, meetingLocale } from "./meeting-datetime";
import { formatMeetingMoment } from "./meeting-detail-format";
import { MeetingRecordingDialog } from "./meeting-recording-dialog";
import { MeetingSectionError, MeetingSectionLoading } from "./meeting-section-state";

/** Where in a recording a moment falls: the COMPLETE recording running then, and the second into it. */
export function recordingOffset(
  at: string | null | undefined,
  recordings: readonly MeetingRecording[],
): { recordingId: string; seconds: number } | null {
  const t = Date.parse(at ?? "");
  if (!Number.isFinite(t)) return null;
  for (const r of recordings) {
    const start = Date.parse(r.started_at ?? "");
    const end = Date.parse(r.ended_at ?? "");
    if (r.status !== "COMPLETE" || !Number.isFinite(start) || t < start || (Number.isFinite(end) && t > end)) continue;
    return { recordingId: r.id, seconds: Math.floor((t - start) / 1000) };
  }
  return null;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatOffset(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

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
  trigger,
}: {
  meetingId: string;
  evidence: readonly MeetingEvidenceRef[];
  /** In place of "Evidence N": what the button shows (a topic's start time) and its accessible name. */
  trigger?: { content: ReactNode; label: string };
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
              aria-label={trigger?.label ?? t("meetings.evidence.chipLabel", { count: evidence.length })}
            >
              {trigger ? (
                trigger.content
              ) : (
                <>
                  <Quote aria-hidden />
                  {t("meetings.evidence.chip")}
                  <span className="tabular-nums">{evidence.length}</span>
                </>
              )}
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
}: {
  meetingId: string;
  evidence: readonly MeetingEvidenceRef[];
  onPlay: (at: { recordingId: string; seconds: number }) => void;
}) {
  const { t, i18n } = useTranslation();
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
            {play ? (
              <Button type="button" size="xs" variant="link" className="h-auto px-0" onClick={() => onPlay(play)}>
                <Play aria-hidden />
                {t("meetings.evidence.openRecording", { time: formatOffset(play.seconds) })}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
