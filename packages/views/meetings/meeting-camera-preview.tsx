"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VideoOff } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";

export type CameraPreviewStatus = "idle" | "loading" | "live" | "denied" | "error";

function previewStatusMessage(
  status: CameraPreviewStatus,
  t: (key: string) => string,
): string | null {
  switch (status) {
    case "denied":
      return t("meetings.devicePreviewPermissionDismissed");
    case "error":
      return t("meetings.devicePreviewError");
    case "loading":
      return t("common.loading");
    default:
      return null;
  }
}

export function MeetingCameraPreview({
  deviceId,
  active,
  className,
}: {
  deviceId?: string;
  active: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraPreviewStatus>("idle");

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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus("live");
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        setStatus(name === "NotAllowedError" || name === "PermissionDeniedError" ? "denied" : "error");
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
          <p className="text-body text-foreground">{t("meetings.devicePreviewEmpty")}</p>
          {statusMessage ? (
            <p className="text-caption text-muted-foreground">{statusMessage}</p>
          ) : null}
        </div>
      ) : null}
      {status === "live" ? (
        <span className="absolute top-3 left-3 rounded-full bg-background/80 px-2.5 py-0.5 text-caption text-foreground ring-1 ring-border">
          {t("meetings.deviceDefaultCamera")}
        </span>
      ) : null}
    </div>
  );
}
