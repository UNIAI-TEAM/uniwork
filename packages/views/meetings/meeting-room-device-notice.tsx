"use client";
import { useEffect, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { MediaDeviceFailure } from "livekit-client";
import { MicOff, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";

type RoomDeviceFailure = "denied" | "in_use" | "missing" | "other";
export type RoomDeviceKind = "audioinput" | "videoinput";
export type RoomDeviceFailures = Partial<Record<RoomDeviceKind, RoomDeviceFailure>>;

/**
 * getUserMedia rejections (and LiveKit's "no such API"): the room is fine,
 * one device is not. Anything else reaching LiveKitRoom's onError is treated
 * as the connection.
 */
const MEDIA_ERROR_NAMES = new Set([
  "NotAllowedError",
  "PermissionDeniedError",
  "NotReadableError",
  "TrackStartError",
  "NotFoundError",
  "DevicesNotFoundError",
  "OverconstrainedError",
  "ConstraintNotSatisfiedError",
  "DeviceUnsupportedError",
]);

export function isMediaDeviceError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    MEDIA_ERROR_NAMES.has(String((error as { name: unknown }).name))
  );
}

export function roomDeviceFailure(failure: MediaDeviceFailure | undefined): RoomDeviceFailure {
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return "denied";
    case MediaDeviceFailure.DeviceInUse:
      return "in_use";
    case MediaDeviceFailure.NotFound:
      return "missing";
    default:
      return "other";
  }
}

const MIC_KEYS: Record<RoomDeviceFailure, string> = {
  denied: "meetings.deviceNoticeMicDenied",
  in_use: "meetings.deviceNoticeMicInUse",
  missing: "meetings.deviceNoticeMicMissing",
  other: "meetings.deviceNoticeMicOther",
};

const CAMERA_KEYS: Record<RoomDeviceFailure, string> = {
  denied: "meetings.deviceNoticeCameraDenied",
  in_use: "meetings.deviceNoticeCameraInUse",
  missing: "meetings.deviceNoticeCameraMissing",
  other: "meetings.deviceNoticeCameraOther",
};

/**
 * A microphone or camera that would not start. The viewer stays in the room
 * with that track off; the notice says why and retries that one track.
 */
export function MeetingRoomDeviceNotice({
  failures,
  deviceIds,
  onResolved,
}: {
  failures: RoomDeviceFailures;
  /** The devices chosen before joining, reused by the retry. */
  deviceIds?: Partial<Record<RoomDeviceKind, string>>;
  onResolved: (kind: RoomDeviceKind) => void;
}) {
  const { t } = useTranslation();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [pending, setPending] = useState<RoomDeviceKind | null>(null);

  // Turned on another way (the control bar, the devices dialog): the notice is done.
  useEffect(() => {
    if (isMicrophoneEnabled && failures.audioinput) onResolved("audioinput");
    if (isCameraEnabled && failures.videoinput) onResolved("videoinput");
  }, [isMicrophoneEnabled, isCameraEnabled, failures, onResolved]);

  const retry = async (kind: RoomDeviceKind) => {
    setPending(kind);
    const deviceId = deviceIds?.[kind];
    const options = deviceId ? { deviceId } : undefined;
    try {
      if (kind === "audioinput") await localParticipant.setMicrophoneEnabled(true, options);
      else await localParticipant.setCameraEnabled(true, options);
    } catch {
      // The room reports the new failure through onMediaDeviceFailure.
    } finally {
      setPending(null);
    }
  };

  const kinds = (["audioinput", "videoinput"] as const).filter((kind) => failures[kind]);
  if (kinds.length === 0) return null;
  return (
    <div className="mb-2 flex shrink-0 flex-col gap-2" data-testid="meeting-device-notice">
      {kinds.map((kind) => {
        const failure = failures[kind] ?? "other";
        const mic = kind === "audioinput";
        return (
          <Notice
            key={kind}
            tone="warning"
            icon={mic ? MicOff : VideoOff}
            layout="inline"
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending === kind}
                aria-busy={pending === kind || undefined}
                onClick={() => void retry(kind)}
              >
                {t(mic ? "meetings.deviceNoticeRetryMic" : "meetings.deviceNoticeRetryCamera")}
              </Button>
            }
          >
            {t(mic ? MIC_KEYS[failure] : CAMERA_KEYS[failure])}
            {failure === "denied" ? (
              <span className="mt-0.5 block font-normal">{t("meetings.devicePreviewDeniedHint")}</span>
            ) : null}
          </Notice>
        );
      })}
    </div>
  );
}
