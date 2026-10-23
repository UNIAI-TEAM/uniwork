"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { RotateCcw, Video } from "lucide-react";
import type { MeetingBackgroundPreset } from "@uniwork/core/meetings/room-preferences";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CAMERA_PREVIEW_FRAME, CameraPreviewPlaceholder } from "./meeting-camera-placeholder";
import {
  applyMeetingBackgroundProcessor,
  meetingBackgroundActive,
  supportsBackgroundProcessors,
} from "./meeting-background-processor";

export { CameraPreviewPlaceholder, CameraPreviewFrame } from "./meeting-camera-placeholder";

export type CameraPreviewStatus =
  "idle" | "loading" | "live" | "denied" | "nocamera" | "inuse" | "timeout" | "error";

/** Failures a second getUserMedia call can fix (permission granted, app closed, camera plugged in). */
const RETRYABLE: ReadonlySet<CameraPreviewStatus> = new Set([
  "denied",
  "nocamera",
  "inuse",
  "timeout",
  "error",
]);

/** How long the permission prompt may stay unanswered before we stop saying "starting". */
const PERMISSION_TIMEOUT_MS = 8000;

function previewStatusMessage(
  status: CameraPreviewStatus,
  t: (key: string) => string,
): string | null {
  switch (status) {
    case "denied":
      return t("meetings.devicePreviewPermissionDismissed");
    case "nocamera":
      return t("meetings.devicePreviewNoCamera");
    case "inuse":
      return t("meetings.devicePreviewInUse");
    case "timeout":
      return t("meetings.devicePreviewTimeout");
    case "error":
      return t("meetings.devicePreviewError");
    default:
      return null;
  }
}

function mapCaptureError(error: unknown): CameraPreviewStatus {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
  if (name === "TimeoutError") return "timeout";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "nocamera";
  // Another app (or tab) holds the device; Chrome's legacy name is TrackStartError.
  if (name === "NotReadableError" || name === "TrackStartError") return "inuse";
  return "error";
}

function stopPreviewTrack(track: LocalVideoTrack | null, video: HTMLVideoElement | null) {
  if (track && video) {
    track.detach(video);
  } else {
    track?.detach();
  }
  track?.stop();
}

export function MeetingCameraPreview({
  deviceId,
  active,
  className,
  onStatusChange,
  background = "none",
  customBackgroundDataUrl = null,
  mirrorCamera = false,
  onRequestEnable,
}: {
  deviceId?: string;
  active: boolean;
  className?: string;
  onStatusChange?: (status: CameraPreviewStatus) => void;
  background?: MeetingBackgroundPreset;
  customBackgroundDataUrl?: string | null;
  mirrorCamera?: boolean;
  /** Shown as a "turn camera on" action while the camera is off. */
  onRequestEnable?: () => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);
  const processorRef = useRef<ReturnType<typeof import("@livekit/track-processors").BackgroundBlur> | null>(
    null,
  );
  const [status, setStatus] = useState<CameraPreviewStatus>("idle");
  // Bumped by "Thử lại" to re-run getUserMedia with the same inputs.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    const video = videoRef.current;

    if (!active) {
      stopPreviewTrack(trackRef.current, video);
      trackRef.current = null;
      processorRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    const startWithBackground = async () => {
      const videoTrack = await createLocalVideoTrack({
        deviceId: deviceId ? { exact: deviceId } : undefined,
      });
      if (cancelled) {
        videoTrack.stop();
        return;
      }
      await applyMeetingBackgroundProcessor(
        videoTrack,
        processorRef,
        background,
        customBackgroundDataUrl,
      );
      if (cancelled) {
        videoTrack.stop();
        return;
      }
      trackRef.current = videoTrack;
      if (video) {
        videoTrack.attach(video);
        await video.play().catch(() => undefined);
      }
      setStatus("live");
    };

    const startWithMediaStream = async () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (!devices.some((d) => d.kind === "videoinput")) {
        if (!cancelled) setStatus("nocamera");
        return;
      }
      let timedOut = false;
      const request = navigator.mediaDevices
        .getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        })
        .then((stream) => {
          if (timedOut || cancelled) {
            stream.getTracks().forEach((track) => track.stop());
          }
          return stream;
        });
      const stream = await Promise.race([
        request,
        new Promise<never>((_, reject) =>
          window.setTimeout(() => {
            timedOut = true;
            reject(new DOMException("camera permission pending", "TimeoutError"));
          }, PERMISSION_TIMEOUT_MS),
        ),
      ]);
      if (cancelled) return;
      streamRef.current = stream;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setStatus("live");
    };

    const start = async () => {
      try {
        stopPreviewTrack(trackRef.current, video);
        trackRef.current = null;
        processorRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (video) video.srcObject = null;

        const useBackground =
          meetingBackgroundActive(background) && (await supportsBackgroundProcessors());
        if (useBackground) {
          await startWithBackground();
        } else {
          await startWithMediaStream();
        }
      } catch (error) {
        if (cancelled) return;
        setStatus(mapCaptureError(error));
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopPreviewTrack(trackRef.current, video);
      trackRef.current = null;
      processorRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [active, deviceId, background, customBackgroundDataUrl, attempt]);

  const statusMessage = previewStatusMessage(status, t);
  const showPlaceholder = status !== "live";
  const placeholderTitle =
    status === "loading"
      ? t("meetings.devicePreviewStarting")
      : status === "idle"
        ? t("meetings.devicePreviewOff")
        : t("meetings.devicePreviewUnavailable");
  const placeholderAction = RETRYABLE.has(status) ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
      <RotateCcw aria-hidden />
      {t("common.retry")}
    </Button>
  ) : status === "idle" && onRequestEnable ? (
    <Button type="button" variant="outline" size="sm" onClick={onRequestEnable}>
      <Video aria-hidden />
      {t("meetings.devicePreviewTurnOn")}
    </Button>
  ) : null;

  return (
    <div className={cn(CAMERA_PREVIEW_FRAME, className)}>
      <video
        ref={videoRef}
        aria-label={t("meetings.devicePreviewTitle")}
        muted
        playsInline
        autoPlay
        className={cn(
          "absolute inset-0 size-full object-cover",
          mirrorCamera && "scale-x-[-1]",
          showPlaceholder && "opacity-0",
        )}
      />
      {showPlaceholder ? (
        <CameraPreviewPlaceholder
          title={placeholderTitle}
          detail={statusMessage}
          hint={status === "denied" ? t("meetings.devicePreviewDeniedHint") : null}
          action={placeholderAction}
        />
      ) : null}
    </div>
  );
}
