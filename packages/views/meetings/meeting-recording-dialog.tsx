"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  loadMeetingRecordingBlob,
  resolveMeetingRecordingPlayback,
} from "@uniwork/core/api/endpoints/meetings";
import {
  getCachedMeetingRecordingPlayback,
  meetingRecordingPlaybackCacheKey,
  rememberMeetingRecordingPlayback,
  releaseMeetingRecordingPlayback,
} from "@uniwork/core/meetings/recording-playback-cache";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Notice } from "../common/notice";
import { MeetingSectionLoading } from "./meeting-section-state";

export function MeetingRecordingDialog({
  open,
  onOpenChange,
  meetingId,
  recordingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  recordingId: string;
}) {
  const { t } = useTranslation();
  const playbackUrlRef = useRef<string | null>(null);
  const cacheKeyRef = useRef(meetingRecordingPlaybackCacheKey(meetingId, recordingId));
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    cacheKeyRef.current = meetingRecordingPlaybackCacheKey(meetingId, recordingId);
  }, [meetingId, recordingId]);

  useEffect(() => {
    if (!open) {
      playbackUrlRef.current = null;
      setStatus("idle");
      return;
    }

    const cacheKey = cacheKeyRef.current;
    const cached = getCachedMeetingRecordingPlayback(cacheKey);
    if (cached) {
      playbackUrlRef.current = cached.url;
      setStatus("ready");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setStatus("loading");

    void resolveMeetingRecordingPlayback(meetingId, recordingId, {
      signal: controller.signal,
    })
      .then((source) => {
        if (cancelled) {
          if (source.kind === "blob") URL.revokeObjectURL(source.url);
          return;
        }
        rememberMeetingRecordingPlayback(cacheKey, source);
        playbackUrlRef.current = source.url;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, meetingId, recordingId]);

  const handleVideoError = () => {
    const cacheKey = cacheKeyRef.current;
    const cached = getCachedMeetingRecordingPlayback(cacheKey);
    if (cached?.kind === "remote") {
      releaseMeetingRecordingPlayback(cacheKey);
      setStatus("loading");
      void loadMeetingRecordingBlob(meetingId, recordingId)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          rememberMeetingRecordingPlayback(cacheKey, { kind: "blob", url });
          playbackUrlRef.current = url;
          setStatus("ready");
        })
        .catch(() => setStatus("error"));
    } else {
      setStatus("error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
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
          <Notice tone="destructive" icon={AlertCircle} layout="inline" live="assertive">
            {t("meetings.recording_play_error")}
          </Notice>
        ) : null}
        {status === "ready" && playbackUrlRef.current ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption -- meeting recording playback has no caption track */
          <video
            className="max-h-[min(70vh,720px)] w-full rounded-md bg-meeting-video-bg object-contain"
            controls
            playsInline
            preload="metadata"
            src={playbackUrlRef.current}
            onError={handleVideoError}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
