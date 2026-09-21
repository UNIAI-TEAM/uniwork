"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import {
  loadChatVoiceRecordingBlob,
  resolveChatVoiceRecordingPlayback,
} from "@uniwork/core/api/endpoints/chat-voice";
import {
  getCachedVoiceRecordingPlayback,
  rememberVoiceRecordingPlayback,
  releaseVoiceRecordingPlayback,
  voiceRecordingPlaybackCacheKey,
} from "@uniwork/core/chat";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";

export function VoiceCallRecordingDialog({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  recordingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  recordingId: string;
}) {
  const { t } = useTranslation();
  const playbackUrlRef = useRef<string | null>(null);
  const cacheKeyRef = useRef(
    voiceRecordingPlaybackCacheKey(workspaceId, roomId, recordingId),
  );
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    cacheKeyRef.current = voiceRecordingPlaybackCacheKey(workspaceId, roomId, recordingId);
  }, [workspaceId, roomId, recordingId]);

  useEffect(() => {
    if (!open) {
      playbackUrlRef.current = null;
      setStatus("idle");
      return;
    }

    const cacheKey = cacheKeyRef.current;
    const cached = getCachedVoiceRecordingPlayback(cacheKey);
    if (cached) {
      playbackUrlRef.current = cached.url;
      setStatus("ready");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setStatus("loading");

    void resolveChatVoiceRecordingPlayback(workspaceId, roomId, recordingId, {
      signal: controller.signal,
    })
      .then((source) => {
        if (cancelled) {
          if (source.kind === "blob") URL.revokeObjectURL(source.url);
          return;
        }
        rememberVoiceRecordingPlayback(cacheKey, source);
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
  }, [open, workspaceId, roomId, recordingId]);

  const handleVideoError = () => {
    const cacheKey = cacheKeyRef.current;
    const cached = getCachedVoiceRecordingPlayback(cacheKey);
    if (cached?.kind === "remote") {
      releaseVoiceRecordingPlayback(cacheKey);
      setStatus("loading");
      void loadChatVoiceRecordingBlob(workspaceId, roomId, recordingId)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          rememberVoiceRecordingPlayback(cacheKey, { kind: "blob", url });
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
          <DialogTitle>{t("chat.voice_call_recording_title")}</DialogTitle>
        </DialogHeader>
        {status === "loading" ? (
          <div aria-busy>
            <span className="sr-only">{t("chat.voice_call_recording_loading")}</span>
            <Skeleton className="aspect-video w-full rounded-md" />
          </div>
        ) : null}
        {status === "error" ? (
          <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-body text-destructive-soft-foreground">
            {t("chat.voice_call_recording_error")}
          </p>
        ) : null}
        {status === "ready" && playbackUrlRef.current ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption -- recorded call playback has no caption track */
          <video
            // The meeting stage's dark plate letterboxes the video in both themes.
            className="max-h-[min(70vh,720px)] w-full rounded-md bg-meeting-bar-bg object-contain"
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
