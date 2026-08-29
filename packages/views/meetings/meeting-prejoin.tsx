"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { MeetingCameraPreview } from "./meeting-camera-preview";
import { formatMeetingRange, meetingLocale } from "./meeting-datetime";

/** What the user chose before connecting; LiveKitRoom takes it as initial media. */
export interface PreJoinChoice {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

type Device = { deviceId: string; label: string };

/** Camera/mic inventory without a LiveKit room. Labels appear once a permission is granted. */
function useMediaDevices(): { cameras: Device[]; mics: Device[] } {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const refresh = () => {
      md.enumerateDevices().then(setDevices, () => undefined);
    };
    refresh();
    md.addEventListener?.("devicechange", refresh);
    return () => md.removeEventListener?.("devicechange", refresh);
  }, []);
  const pick = (kind: MediaDeviceKind): Device[] =>
    devices.filter((d) => d.kind === kind && d.deviceId).map((d) => ({ deviceId: d.deviceId, label: d.label }));
  return { cameras: pick("videoinput"), mics: pick("audioinput") };
}

function MediaToggle({
  on,
  onLabel,
  offLabel,
  onClick,
  children,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon-lg"
      variant={on ? "outline" : "destructive"}
      aria-label={on ? onLabel : offLabel}
      aria-pressed={on}
      onClick={onClick}
      className="rounded-full"
    >
      {children}
    </Button>
  );
}

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
  const { cameras, mics } = useMediaDevices();
  const deviceItems = (list: Device[]) =>
    list.map((d) => ({ value: d.deviceId, label: d.label || t("meetings.deviceUnnamed") }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 sm:px-4">
        <Button type="button" variant="ghost" onClick={onLeave} className="gap-1.5 px-2 text-muted-foreground">
          <ArrowLeft aria-hidden className="size-4" />
          {t("common.back")}
        </Button>
      </header>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-6 px-4 pb-8 lg:flex-row lg:items-center lg:gap-10">
        <div className="w-full min-w-0 lg:flex-1">
          <MeetingCameraPreview active={video} deviceId={videoDeviceId || undefined} className="aspect-video min-h-0" />
          <div className="mt-3 flex justify-center gap-3">
            <MediaToggle on={audio} onLabel={t("meetings.micOff")} offLabel={t("meetings.micOn")} onClick={() => setAudio((v) => !v)}>
              {audio ? <Mic aria-hidden /> : <MicOff aria-hidden />}
            </MediaToggle>
            <MediaToggle on={video} onLabel={t("meetings.cameraOff")} offLabel={t("meetings.cameraOn")} onClick={() => setVideo((v) => !v)}>
              {video ? <Video aria-hidden /> : <VideoOff aria-hidden />}
            </MediaToggle>
          </div>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-4 lg:w-80">
          <div>
            <p className="text-caption text-muted-foreground">{t("meetings.prejoinTitle")}</p>
            <h1 className="mt-1 text-pretty text-title font-semibold text-foreground">{meeting?.title ?? t("meetings.title")}</h1>
            {meeting ? (
              <p className="mt-1 text-label tabular-nums text-muted-foreground">
                {formatMeetingRange(meeting.starts_at, meeting.ends_at, meeting.timezone, meetingLocale(i18n.language))}
              </p>
            ) : null}
          </div>
          {mics.length > 0 ? (
            <Field>
              <FieldLabel>{t("meetings.deviceMic")}</FieldLabel>
              <Select value={audioDeviceId || mics[0]!.deviceId} onValueChange={(v) => v && setAudioDeviceId(v)} items={deviceItems(mics)} />
            </Field>
          ) : null}
          {cameras.length > 0 ? (
            <Field>
              <FieldLabel>{t("meetings.deviceCamera")}</FieldLabel>
              <Select value={videoDeviceId || cameras[0]!.deviceId} onValueChange={(v) => v && setVideoDeviceId(v)} items={deviceItems(cameras)} />
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
          <p className="text-caption text-muted-foreground">{t("meetings.prejoinHint")}</p>
        </div>
      </div>
    </div>
  );
}
