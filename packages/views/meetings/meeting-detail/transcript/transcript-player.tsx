"use client";
import { CircleAlert, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRecordings } from "@uniwork/core/meetings";
import { meetingLocale } from "../../meeting-datetime";
import { formatMeetingDayTime } from "../../meeting-detail-format";
import { NoticeLine } from "../ui/notice-line";
import { TextButton } from "../ui/text-button";

const STATUSES = new Set(["ACTIVE", "PROCESSING"]);

/**
 * The meeting's recordings above the chapter bar (kit `.player`), drawn only
 * when there are some: each finished one plays in the recording dialog (its
 * own player seeks and changes speed); one still being made or that failed
 * says so. A list that did not load says so, with a retry.
 */
export function TranscriptPlayer({
  meetingId,
  onPlay,
}: {
  meetingId: string;
  onPlay: (at: { recordingId: string }) => void;
}) {
  // shortcut: plays in the recording dialog, not inline with ±15s and the chapter bar as scrubber; build that when recordings are common.
  const { t, i18n } = useTranslation();
  const query = useRecordings(meetingId);
  const recordings = query.data ?? [];
  if (query.isError && !query.data) {
    return (
      <NoticeLine tone="destructive" icon={CircleAlert} role="alert">
        {t("meetings.recordingsLoadFailed")}
        <TextButton className="ml-1 py-0 align-baseline text-body" onClick={() => void query.refetch()}>
          {t("meetings.detail.transcript.retry")}
        </TextButton>
      </NoticeLine>
    );
  }
  if (recordings.length === 0) return null;
  const locale = meetingLocale(i18n.language);
  return (
    <ul aria-label={t("meetings.recordings")}>
      {recordings.map((r) => {
        const when = r.started_at ? formatMeetingDayTime(r.started_at, locale) : "";
        return (
          <li key={r.id} className="flex min-h-12 items-center gap-3">
            {r.status === "COMPLETE" ? (
              <button
                type="button"
                aria-label={t("meetings.detail.transcript.playRecording", { when })}
                onClick={() => onPlay({ recordingId: r.id })}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5"
              >
                <Play aria-hidden className="size-4" />
              </button>
            ) : null}
            <span className="text-body">{t("meetings.recording_play_title")}</span>
            <span className="text-caption text-muted-foreground tabular-nums">{when}</span>
            {r.status === "FAILED" ? (
              <span className="flex items-center gap-1 text-caption text-destructive">
                <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                {t("meetings.recordingFailed")}
              </span>
            ) : STATUSES.has(r.status) ? (
              <span className="text-caption text-muted-foreground">{t(`meetings.recordingStatus.${r.status}`)}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
