"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VideoOff } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

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

export function MeetingCameraPreview({
  deviceId,
  active,
  className,
  onStatusChange,
}: {
  deviceId?: string;
  active: boolean;
  className?: string;
  onStatusChange?: (status: CameraPreviewStatus) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraPreviewStatus>("idle");

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (!active) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    const start = async () => {
      try {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        // Without a camera getUserMedia can hang or fail slowly; say so up front.
        const devices = await navigator.mediaDevices
          .enumerateDevices()
          .catch(() => []);
        if (!devices.some((d) => d.kind === "videoinput")) {
          if (!cancelled) setStatus("nocamera");
          return;
        }
        // A permission prompt left unanswered would otherwise keep us "starting" forever.
        let timedOut = false;
        const request = navigator.mediaDevices
          .getUserMedia({
            video: deviceId ? { deviceId: { exact: deviceId } } : true,
            audio: false,
          })
          .then((s) => {
            if (timedOut || cancelled)
              s.getTracks().forEach((track) => track.stop());
            return s;
          });
        const stream = await Promise.race([
          request,
          new Promise<never>((_, reject) =>
            window.setTimeout(() => {
              timedOut = true;
              reject(
                new DOMException("camera permission pending", "TimeoutError"),
              );
            }, PERMISSION_TIMEOUT_MS),
          ),
        ]);
        if (cancelled) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus("live");
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError")
          setStatus("denied");
        else if (name === "TimeoutError") setStatus("timeout");
        else if (name === "NotFoundError" || name === "OverconstrainedError")
          setStatus("nocamera");
        else setStatus("error");
      }
    };

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [active, deviceId]);

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
            <p className="text-caption text-muted-foreground">
              {statusMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
