"use client";
import { useCallback, useState } from "react";
import { ArrowLeft, Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParticipants } from "@uniwork/core/meetings";
import { prejoinMicOn, useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import {
  MeetingCameraPreview,
  type CameraPreviewStatus,
} from "./meeting-camera-preview";
import { formatMeetingRange, meetingLocale } from "./meeting-datetime";
import { MeetingCanvas } from "./meeting-canvas";
import { MeetingDeviceField } from "./meeting-device-field";
import { MeetingMediaControlBar, useMediaDevices } from "./meeting-media-controls";
import { MeetingMediaPermissionAction, MeetingMicLevel } from "./meeting-room-mic-check";

/** What the user chose before connecting; LiveKitRoom takes it as initial media. */
export interface PreJoinChoice {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

export function MeetingPreJoin({
  meeting,
  loading = false,
  onJoin,
  onLeave,
}: {
  meeting?: Meeting;
  /** The meeting is still being fetched: draw skeleton lines, not a fallback title. */
  loading?: boolean;
  onJoin: (choice: PreJoinChoice) => void;
  onLeave: () => void;
}) {
  const { t, i18n } = useTranslation();
  // The roster (people invited and not removed) stands in for how full the
  // room will be: prejoin has no live count. The room reads the same query.
  const { data: roster } = useParticipants(meeting?.id ?? "");
  const rosterSize = roster?.filter((p) => p.status === "ACTIVE").length;
  const rememberedMic = useMeetingRoomPreferencesStore((s) => s.joinWithMic);
  const setJoinWithMic = useMeetingRoomPreferencesStore((s) => s.setJoinWithMic);
  // Derived until the person touches the toggle, so a roster that arrives
  // after the first paint still sets the default.
  const [audioChoice, setAudioChoice] = useState<boolean | null>(null);
  const micDefault = prejoinMicOn(rememberedMic, rosterSize);
  const audio = audioChoice ?? micDefault;
  const mutedForCrowd = audioChoice === null && rememberedMic === null && !micDefault;
  const [video, setVideo] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const { cameras, mics, refresh } = useMediaDevices();
  // Same preferences MeetingCameraBackgroundSync applies in the room, so the
  // preview shows what the others will see.
  const background = useMeetingRoomPreferencesStore((s) => s.background);
  const customBackgroundDataUrl = useMeetingRoomPreferencesStore((s) => s.customBackgroundDataUrl);
  const mirrorCamera = useMeetingRoomPreferencesStore((s) => s.mirrorCamera);
  const onPreviewStatus = useCallback(
    (s: CameraPreviewStatus) => s === "live" && refresh(),
    [refresh],
  );
  const showSkeleton = loading && !meeting;

  return (
    <MeetingCanvas className="overflow-y-auto">
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
      {/* Centred as one block, tops aligned: the card starts where the camera does. */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-stretch gap-6 px-4 pb-8 lg:my-auto lg:flex-none lg:flex-row lg:items-start lg:gap-8">
        {/* The camera frame is its own `dark` island; the toggles below keep
            the page's tokens so they match the room's control bar exactly. */}
        <div className="w-full min-w-0 rounded-2xl bg-meeting-stage p-3 ring-1 ring-surface-border lg:flex-1">
          <MeetingCameraPreview
            active={video}
            deviceId={videoDeviceId || undefined}
            // The stage already draws the edge; a second ring framed a frame.
            className="aspect-video min-h-0 rounded-xl ring-0"
            onStatusChange={onPreviewStatus}
            onRequestEnable={() => setVideo(true)}
            background={background}
            customBackgroundDataUrl={customBackgroundDataUrl}
            mirrorCamera={mirrorCamera}
          />
          <MeetingMediaControlBar
            audio={audio}
            video={video}
            micLabel={t("meetings.deviceMic")}
            cameraLabel={t("meetings.deviceCamera")}
            onAudioToggle={() => {
              setAudioChoice(!audio);
              setJoinWithMic(!audio);
            }}
            onVideoToggle={() => setVideo((v) => !v)}
            className="mt-3 flex justify-center gap-3"
          />
          {mutedForCrowd ? (
            <p className="mt-2 text-center text-caption text-meeting-bar-muted-foreground" data-testid="prejoin-mic-crowded">
              {t("meetings.prejoinMicOffCrowded", { count: rosterSize })}
            </p>
          ) : null}
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-surface lg:mx-0 lg:w-80">
          <div aria-busy={showSkeleton || undefined}>
            <p className="text-overline text-muted-foreground">
              {t("meetings.prejoinTitle")}
            </p>
            {showSkeleton ? (
              <>
                <Skeleton className="mt-2 h-6 w-4/5" />
                <Skeleton className="mt-2 h-4 w-3/5" />
                <span className="sr-only">{t("common.loading")}</span>
              </>
            ) : (
              <h1 className="mt-1 text-pretty text-title font-semibold text-foreground">
                {meeting?.title ?? t("meetings.title")}
              </h1>
            )}
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
          <MeetingDeviceField
            id="prejoin-mic"
            label={t("meetings.deviceMic")}
            devices={mics}
            value={audioDeviceId}
            onValueChange={setAudioDeviceId}
            emptyDescription={t("meetings.deviceMicNeedsPermission")}
            emptyAction={
              <MeetingMediaPermissionAction
                label={t("meetings.micAllow")}
                icon={Mic}
                deniedMessage={t("meetings.micAllowDenied")}
                onGranted={refresh}
              />
            }
          >
            {audio ? <MeetingMicLevel deviceId={audioDeviceId || mics[0]?.deviceId} className="mt-1" /> : null}
          </MeetingDeviceField>
          <MeetingDeviceField
            id="prejoin-camera"
            label={t("meetings.deviceCamera")}
            devices={cameras}
            value={videoDeviceId}
            onValueChange={setVideoDeviceId}
            emptyDescription={t("meetings.deviceCameraNeedsPermission")}
          />
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
    </MeetingCanvas>
  );
}
