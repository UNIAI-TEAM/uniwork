"use client";

import { useTranslation } from "react-i18next";
import { MeetingDeviceField } from "./meeting-device-field";
import type { MediaDevice } from "./meeting-media-controls";

/**
 * Mic and camera pickers for the guest invite page. Loaded lazily by
 * MeetingPublicInviteForm so the Select primitive stays out of the guest entry
 * chunk; a list is passed only once the browser has named its devices and
 * that input is on.
 */
export function MeetingInviteDevicePickers({
  mics,
  cameras,
  audioDeviceId,
  videoDeviceId,
  onAudioDeviceChange,
  onVideoDeviceChange,
}: {
  mics?: MediaDevice[];
  cameras?: MediaDevice[];
  audioDeviceId: string;
  videoDeviceId: string;
  onAudioDeviceChange: (deviceId: string) => void;
  onVideoDeviceChange: (deviceId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {mics ? (
        <MeetingDeviceField
          id="guest-mic"
          label={t("meetings.deviceMic")}
          devices={mics}
          value={audioDeviceId}
          onValueChange={onAudioDeviceChange}
          emptyDescription={t("meetings.deviceMicNeedsPermission")}
        />
      ) : null}
      {cameras ? (
        <MeetingDeviceField
          id="guest-camera"
          label={t("meetings.deviceCamera")}
          devices={cameras}
          value={videoDeviceId}
          onValueChange={onVideoDeviceChange}
          emptyDescription={t("meetings.deviceCameraNeedsPermission")}
        />
      ) : null}
    </div>
  );
}
