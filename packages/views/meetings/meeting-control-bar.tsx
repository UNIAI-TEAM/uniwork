"use client";
import { useState, type MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, MonitorUp, PhoneOff, Settings2, Video, VideoOff } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";

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

export function MeetingControlBar({
  className,
  onLeave,
}: {
  className?: string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });

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
