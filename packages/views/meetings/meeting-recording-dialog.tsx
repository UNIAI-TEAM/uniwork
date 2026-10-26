"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  loadMeetingRecordingBlob,
  resolveMeetingRecordingPlayback,
  type MeetingRecordingPlaybackSource,
} from "@uniwork/core/api/endpoints/meetings";
import { useRecordings } from "@uniwork/core/meetings";
import {
  getCachedMeetingRecordingPlayback,
  meetingRecordingPlaybackCacheKey,
  rememberMeetingRecordingPlayback,
  releaseMeetingRecordingPlayback,
} from "@uniwork/core/meetings/recording-playback-cache";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Notice } from "../common/notice";
import { MeetingSectionLoading } from "./meeting-section-state";
import { transcriptSpeaker } from "./transcript/transcript-speaker";

type Translate = ReturnType<typeof useTranslation>["t"];

/** A cue stays up at most this long when the next line comes much later. */
const MAX_CUE_MS = 6000;

function vttTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`;
}

const vttText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s+/g, " ").trim();

/**
 * WebVTT captions for a recording from the transcript lines spoken while it
 * ran: each line from its `spoken_at` less the recording's start, until the
 * next line. Null when no line falls inside the recording.
 */
export function recordingCaptionsVtt(
  segments: readonly MeetingTranscriptSegment[],
  startedAt: string | undefined,
  endedAt: string | undefined,
  t: Translate,
): string | null {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const parsedEnd = endedAt ? Date.parse(endedAt) : NaN;
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Infinity;
  const lines = segments
    .map((s) => ({ at: Date.parse(s.spoken_at), text: vttText(s.text), who: vttText(transcriptSpeaker(s, t)) }))
    .filter((l) => Number.isFinite(l.at) && l.at >= start && l.at <= end && l.text)
    .sort((a, b) => a.at - b.at);
  if (lines.length === 0) return null;
  const cues = lines.map((l, i) => {
    const from = l.at - start;
    const next = lines[i + 1]?.at ?? Infinity;
    const to = Math.max(from + 1000, Math.min(next - start, from + MAX_CUE_MS, end - start));
    return `${vttTime(from)} --> ${vttTime(to)}\n${l.who}: ${l.text}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/**
 * The captions' language: the one most of the lines carry (the scribe and
 * uploads tag each line), else the reader's own.
 */
export function captionsLanguage(segments: readonly MeetingTranscriptSegment[] | undefined, fallback: string): string {
  const counts = new Map<string, number>();
  for (const s of segments ?? []) if (s.language) counts.set(s.language, (counts.get(s.language) ?? 0) + 1);
  let best = "";
  for (const [lang, n] of counts) if (n > (counts.get(best) ?? 0)) best = lang;
  return best || (fallback.startsWith("en") ? "en" : "vi");
}

export function MeetingRecordingDialog({
  open,
  onOpenChange,
  meetingId,
  recordingId,
  startAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  recordingId: string;
  /** Seconds into the recording to start at (an evidence chip's spoken line). */
  startAt?: number;
}) {
  const { t, i18n } = useTranslation();
  const [source, setSource] = useState<MeetingRecordingPlaybackSource | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // Bumped by Retry: the load effect runs again without closing the dialog.
  const [attempt, setAttempt] = useState(0);
  // The presigned URL failed in the player: fetch the file through the API instead.
  const [proxy, setProxy] = useState(false);
  const recording = useRecordings(meetingId, open).data?.find((r) => r.id === recordingId);
  // The whole meeting, not the pages a reader loaded: a long recording keeps its first part captioned (UNI-1995 #9).
  const segments = useFullTranscript(meetingId, open).data;
  const [captionsUrl, setCaptionsUrl] = useState<string | null>(null);
  const srcLang = useMemo(() => captionsLanguage(segments, i18n.language), [segments, i18n.language]);

  const vtt = useMemo(
    () => (segments ? recordingCaptionsVtt(segments, recording?.started_at, recording?.ended_at, t) : null),
    [segments, recording?.started_at, recording?.ended_at, t],
  );
  useEffect(() => {
    if (!open || !vtt) {
      setCaptionsUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setCaptionsUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [open, vtt]);

  useEffect(() => {
    if (!open) {
      setSource(null);
      setStatus("idle");
      // The list keeps this dialog mounted: the next open tries the presigned URL again
      // rather than downloading the whole file into memory because of one old error.
      setProxy(false);
      return;
    }

    const cacheKey = meetingRecordingPlaybackCacheKey(meetingId, recordingId);
    const cached = proxy ? null : getCachedMeetingRecordingPlayback(cacheKey);
    if (cached) {
      setSource(cached);
      setStatus("ready");
      return;
    }

    const controller = new AbortController();
    // A blob is the whole file in memory: owned here and revoked on close.
    let blobUrl: string | null = null;
    setStatus("loading");
    const load: Promise<MeetingRecordingPlaybackSource> = proxy
      ? loadMeetingRecordingBlob(meetingId, recordingId, { signal: controller.signal }).then((blob) => ({
          kind: "blob",
          url: URL.createObjectURL(blob),
        }))
      : resolveMeetingRecordingPlayback(meetingId, recordingId, { signal: controller.signal });

    void load
      .then((next) => {
        if (next.kind === "blob") blobUrl = next.url;
        if (controller.signal.aborted) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (next.kind === "remote") rememberMeetingRecordingPlayback(cacheKey, next);
        setSource(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });

    return () => {
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [open, meetingId, recordingId, attempt, proxy]);

  const handleVideoError = () => {
    if (source?.kind === "remote" && !proxy) {
      releaseMeetingRecordingPlayback(meetingRecordingPlaybackCacheKey(meetingId, recordingId));
      setProxy(true);
    } else {
      setStatus("error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("meetings.recording_play_title")}</DialogTitle>
        </DialogHeader>
        {status === "loading" ? (
          // Shaped like the player it turns into, so the dialog does not jump.
          <MeetingSectionLoading label={t("meetings.recording_play_loading")}>
            <Skeleton aria-hidden className="aspect-video w-full rounded-md" />
          </MeetingSectionLoading>
        ) : null}
        {status === "error" ? (
          <Notice
            tone="destructive"
            icon={CircleAlert}
            layout="inline"
            live="assertive"
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  // A cached URL the player already failed on would be served again.
                  releaseMeetingRecordingPlayback(meetingRecordingPlaybackCacheKey(meetingId, recordingId));
                  setAttempt((n) => n + 1);
                }}
              >
                <RefreshCw aria-hidden />
                {t("common.retry")}
              </Button>
            }
          >
            {t("meetings.recording_play_error")}
          </Notice>
        ) : null}
        {status === "ready" && source ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption -- the track is there whenever transcript lines cover the recording; a recording nobody transcribed has no words to caption */
          <video
            className="max-h-[min(70vh,720px)] w-full rounded-md bg-meeting-video-bg object-contain"
            controls
            playsInline
            preload="metadata"
            src={source.url}
            onLoadedMetadata={(e) => {
              if (startAt) e.currentTarget.currentTime = startAt;
            }}
            onError={handleVideoError}
          >
            {captionsUrl ? (
              <track kind="captions" src={captionsUrl} srcLang={srcLang} label={t("meetings.recording_captions")} default />
            ) : null}
          </video>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
