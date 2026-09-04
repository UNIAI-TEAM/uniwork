"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { VideoOff } from "lucide-react";
import type { MeetingBackgroundPreset } from "@uniwork/core/meetings/room-preferences";
import { cn } from "@uniwork/ui/lib/utils";
import {
  applyMeetingBackgroundProcessor,
  meetingBackgroundActive,
  supportsBackgroundProcessors,
} from "./meeting-background-processor";

export type CameraPreviewStatus =
  "idle" | "loading" | "live" | "denied" | "nocamera" | "timeout" | "error";

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
}: {
  deviceId?: string;
  active: boolean;
  className?: string;
  onStatusChange?: (status: CameraPreviewStatus) => void;
  background?: MeetingBackgroundPreset;
  customBackgroundDataUrl?: string | null;
  mirrorCamera?: boolean;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);
  const processorRef = useRef<ReturnType<typeof import("@livekit/track-processors").BackgroundBlur> | null>(
    null,
  );
  const [status, setStatus] = useState<CameraPreviewStatus>("idle");

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
          meetingBackgroundActive(background) && supportsBackgroundProcessors();
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
  }, [active, deviceId, background, customBackgroundDataUrl]);

  const statusMessage = previewStatusMessage(status, t);
  const showPlaceholder = status !== "live";

  return (
    <div
      className={cn(
        "dark relative flex aspect-[4/3] min-h-48 w-full items-center justify-center overflow-hidden rounded-xl bg-rail ring-1 ring-border",
        className,
      )}
    >
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
        <div className="flex max-w-xs flex-col items-center gap-2 px-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <VideoOff aria-hidden className="size-6" />
          </span>
          <p className="text-body text-foreground">
            {status === "loading"
              ? t("meetings.devicePreviewStarting")
              : t("meetings.devicePreviewEmpty")}
          </p>
          {statusMessage ? (
            <p className="text-caption text-muted-foreground">{statusMessage}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
