"use client";
import { useCallback, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import {
  MeetingCameraPreview,
  type CameraPreviewStatus,
} from "./meeting-camera-preview";
import { formatMeetingRange, meetingLocale } from "./meeting-datetime";
import { MeetingMediaControlBar, useMediaDevices } from "./meeting-media-controls";

/** What the user chose before connecting; LiveKitRoom takes it as initial media. */
export interface PreJoinChoice {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

type Device = { deviceId: string; label: string };

export function MeetingPreJoin({
  meeting,
  onJoin,
  onLeave,
}: {
  meeting?: Meeting;
  onJoin: (choice: PreJoinChoice) => void;
  onLeave: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const { cameras, mics, refresh } = useMediaDevices();
  const onPreviewStatus = useCallback(
    (s: CameraPreviewStatus) => s === "live" && refresh(),
    [refresh],
  );
  const deviceItems = (list: Device[]) =>
    list.map((d) => ({
      value: d.deviceId,
      label: d.label || t("meetings.deviceUnnamed"),
    }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 sm:px-4">
        <Button
          type="button"
          variant="ghost"
          onClick={onLeave}
          className="gap-1.5 px-2 text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t("common.back")}
        </Button>
      </header>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-6 px-4 pb-8 lg:flex-row lg:items-center lg:gap-10">
        <div className="w-full min-w-0 lg:flex-1">
          <MeetingCameraPreview
            active={video}
            deviceId={videoDeviceId || undefined}
            className="aspect-video min-h-0 rounded-2xl"
            onStatusChange={onPreviewStatus}
          />
          <MeetingMediaControlBar
            audio={audio}
            video={video}
            micLabel={t("meetings.deviceMic")}
            cameraLabel={t("meetings.deviceCamera")}
            onAudioToggle={() => setAudio((v) => !v)}
            onVideoToggle={() => setVideo((v) => !v)}
            className="mt-3 flex justify-center gap-3"
          />
        </div>
        <div className="flex w-full max-w-sm flex-col gap-4 lg:w-80">
          <div>
            <p className="text-caption text-muted-foreground">
              {t("meetings.prejoinTitle")}
            </p>
            <h1 className="mt-1 text-pretty text-title font-semibold text-foreground">
              {meeting?.title ?? t("meetings.title")}
            </h1>
            {meeting ? (
              <p className="mt-1 text-label tabular-nums text-muted-foreground">
                {formatMeetingRange(
                  meeting.starts_at,
                  meeting.ends_at,
                  meetingLocale(i18n.language),
                )}
              </p>
            ) : null}
          </div>
          {mics.length > 0 ? (
            <Field>
              <FieldLabel htmlFor="prejoin-mic">
                {t("meetings.deviceMic")}
              </FieldLabel>
              <Select
                id="prejoin-mic"
                value={audioDeviceId || mics[0]!.deviceId}
                onValueChange={(v) => v && setAudioDeviceId(v)}
                items={deviceItems(mics)}
              />
            </Field>
          ) : null}
          {cameras.length > 0 ? (
            <Field>
              <FieldLabel htmlFor="prejoin-camera">
                {t("meetings.deviceCamera")}
              </FieldLabel>
              <Select
                id="prejoin-camera"
                value={videoDeviceId || cameras[0]!.deviceId}
                onValueChange={(v) => v && setVideoDeviceId(v)}
                items={deviceItems(cameras)}
              />
            </Field>
          ) : null}
          <Button
            type="button"
            variant="brand"
            className="h-11 w-full"
            onClick={() =>
              onJoin({
                audio,
                video,
                audioDeviceId: audioDeviceId || undefined,
                videoDeviceId: videoDeviceId || undefined,
              })
            }
          >
            {t("meetings.join")}
          </Button>
          <p className="text-caption text-muted-foreground">
            {t("meetings.prejoinHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
