"use client";
import { useState, type MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Captions, Circle, Hand, Mic, MicOff, MonitorUp, PhoneOff, Settings2, SmilePlus, Square, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { useStartRecording, useStopRecording } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";
import { REACTIONS } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";

function LabeledControl({
  label,
  caption,
  pressed,
  tone,
  onClick,
  disabled,
  children,
}: {
  label: string;
  caption: string;
  pressed?: boolean;
  tone?: "off" | "active";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex w-14 flex-col items-center gap-1">
      <Button
        type="button"
        size="icon-lg"
        variant={tone === "off" ? "destructive" : tone === "active" ? "brandSubtle" : pressed ? "secondary" : "outline"}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className="rounded-full"
      >
        {children}
      </Button>
      <span aria-hidden className="text-caption text-muted-foreground">
        {caption}
      </span>
    </div>
  );
}

function DeviceSettingsControl() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <MeetingDevicesDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <div className="flex w-14 flex-col items-center gap-1">
          <DialogTrigger
            render={
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                aria-label={t("meetings.devicesSettingsTitle")}
                className="rounded-full"
              />
            }
          >
            <Settings2 aria-hidden />
          </DialogTrigger>
          <span aria-hidden className="text-caption text-muted-foreground">
            {t("meetings.devices")}
          </span>
        </div>
      }
    />
  );
}

function ReactionsControl() {
  const { t } = useTranslation();
  const { react } = useMeetingSignals();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex w-14 flex-col items-center gap-1">
        <PopoverTrigger
          render={
            <Button type="button" size="icon-lg" variant="outline" aria-label={t("meetings.reactions")} className="rounded-full" />
          }
        >
          <SmilePlus aria-hidden />
        </PopoverTrigger>
        <span aria-hidden className="text-caption text-muted-foreground">
          {t("meetings.react")}
        </span>
      </div>
      <PopoverContent side="top" className="flex w-auto gap-1 p-1.5">
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-label={r}
            className="flex size-10 items-center justify-center rounded-full text-title hover:bg-muted"
            onClick={() => {
              react(r);
              setOpen(false);
            }}
          >
            {r}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function MeetingControlBar({
  className,
  onLeave,
  meetingId,
  canHost = false,
  recordingEnabled = false,
  recording = false,
  captionsOn = false,
  captionsAvailable = false,
  onToggleCaptions,
}: {
  className?: string;
  onLeave: () => void;
  meetingId?: string;
  canHost?: boolean;
  recordingEnabled?: boolean;
  recording?: boolean;
  captionsOn?: boolean;
  captionsAvailable?: boolean;
  onToggleCaptions?: () => void;
}) {
  const { t } = useTranslation();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });
  const { handRaised, toggleHand } = useMeetingSignals();
  const startRec = useStartRecording(meetingId ?? "");
  const stopRec = useStopRecording(meetingId ?? "");
  const recPending = startRec.isPending || stopRec.isPending;

  return (
    <footer
      className={cn(
        "shrink-0 bg-app-shell px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-4",
        className,
      )}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div />
        <div className="flex min-w-0 items-end justify-center gap-1 overflow-x-auto sm:gap-2">
          <LabeledControl
            label={mic.enabled ? t("meetings.micOff") : t("meetings.micOn")}
            caption={t("meetings.mic")}
            pressed={mic.enabled}
            tone={mic.enabled ? undefined : "off"}
            disabled={mic.pending}
            onClick={() => {
              void mic.toggle();
            }}
          >
            {mic.enabled ? <Mic aria-hidden /> : <MicOff aria-hidden />}
          </LabeledControl>
          <LabeledControl
            label={camera.enabled ? t("meetings.cameraOff") : t("meetings.cameraOn")}
            caption={t("meetings.camera")}
            pressed={camera.enabled}
            disabled={camera.pending}
            onClick={() => {
              void camera.toggle();
            }}
          >
            {camera.enabled ? <Video aria-hidden /> : <VideoOff aria-hidden />}
          </LabeledControl>
          <DeviceSettingsControl />
          <LabeledControl
            label={screen.enabled ? t("meetings.stopShare") : t("meetings.shareScreen")}
            caption={t("meetings.share")}
            pressed={screen.enabled}
            tone={screen.enabled ? "active" : undefined}
            disabled={screen.pending}
            onClick={() => {
              void screen.toggle();
            }}
          >
            <MonitorUp aria-hidden />
          </LabeledControl>
          <LabeledControl
            label={handRaised ? t("meetings.lowerHand") : t("meetings.raiseHand")}
            caption={t("meetings.hand")}
            pressed={handRaised}
            tone={handRaised ? "active" : undefined}
            onClick={toggleHand}
          >
            <Hand aria-hidden />
          </LabeledControl>
          <ReactionsControl />
          {captionsAvailable && onToggleCaptions ? (
            <LabeledControl
              label={captionsOn ? t("meetings.captionsOff") : t("meetings.captionsOn")}
              caption={t("meetings.captions")}
              pressed={captionsOn}
              tone={captionsOn ? "active" : undefined}
              onClick={onToggleCaptions}
            >
              <Captions aria-hidden />
            </LabeledControl>
          ) : null}
          {canHost && recordingEnabled && meetingId ? (
            <LabeledControl
              label={recording ? t("meetings.stopRecording") : t("meetings.startRecording")}
              caption={t("meetings.record")}
              pressed={recording}
              tone={recording ? "off" : undefined}
              disabled={recPending}
              onClick={() => {
                const m = recording ? stopRec : startRec;
                m.mutate(undefined, { onError: () => toast.error(t("common.error")) });
              }}
            >
              {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
            </LabeledControl>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="destructive"
            onClick={onLeave}
            className="h-11 shrink-0 rounded-xl px-4"
            aria-label={t("meetings.leave")}
          >
            <PhoneOff aria-hidden />
            {t("meetings.leave")}
          </Button>
        </div>
      </div>
    </footer>
  );
}
