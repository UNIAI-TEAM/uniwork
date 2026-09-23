"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
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
  // Bumped by "Thử lại": re-runs the load without closing the dialog.
  const [attempt, setAttempt] = useState(0);

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
  }, [open, workspaceId, roomId, recordingId, attempt]);

  const retry = () => {
    releaseVoiceRecordingPlayback(cacheKeyRef.current);
    playbackUrlRef.current = null;
    setAttempt((n) => n + 1);
  };

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
      <DialogContent className="sm:max-w-3xl" closeLabel={t("common.close")}>
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
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-md bg-destructive-soft px-3 py-2 text-body text-destructive-soft-foreground"
          >
            <span className="min-w-0 flex-1">{t("chat.voice_call_recording_error")}</span>
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              {t("common.retry")}
            </Button>
          </div>
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
