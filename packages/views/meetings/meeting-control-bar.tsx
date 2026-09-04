"use client";
import { useState, type MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Captions,
  Circle,
  Hand,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Settings2,
  SmilePlus,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import { toast } from "sonner";
import { useStartRecording, useStopRecording } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";
import { REACTIONS } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";

/** Caption under the control on wider screens; icon only on phones. */
const CONTROL_SLOT = "flex w-11 flex-col items-center gap-1 sm:w-14";
const CONTROL_CAPTION = "hidden text-caption text-muted-foreground sm:block";

/**
 * Toggle-button pattern: the accessible name is the fixed `caption`
 * ("Mic", "Camera"), `aria-pressed` carries on/off; icon and tone echo it.
 */
function LabeledControl({
  caption,
  pressed,
  tone,
  onClick,
  disabled,
  children,
}: {
  caption: string;
  pressed?: boolean;
  tone?: "off" | "active";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={CONTROL_SLOT}>
      <Button
        type="button"
        size="icon-lg"
        variant={
          tone === "off"
            ? "destructive"
            : tone === "active"
              ? "brandSubtle"
              : pressed
                ? "secondary"
                : "outline"
        }
        aria-label={caption}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className="rounded-full"
      >
        {children}
      </Button>
      <span aria-hidden className={CONTROL_CAPTION}>
        {caption}
      </span>
    </div>
  );
}

/** Row inside the phone "More" popover: same state, text label instead of a caption. */
function MenuControl({
  caption,
  pressed,
  onClick,
  disabled,
  children,
}: {
  caption: string;
  pressed?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "ghost"}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="h-11 w-full justify-start gap-3"
    >
      {children}
      {caption}
    </Button>
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
        <div className={CONTROL_SLOT}>
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
          <span aria-hidden className={CONTROL_CAPTION}>
            {t("meetings.devices")}
          </span>
        </div>
      }
    />
  );
}

function ReactionsControl({ inMenu = false }: { inMenu?: boolean }) {
  const { t } = useTranslation();
  const { react } = useMeetingSignals();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {inMenu ? (
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full justify-start gap-3"
            />
          }
        >
          <SmilePlus aria-hidden />
          {t("meetings.react")}
        </PopoverTrigger>
      ) : (
        <div className={CONTROL_SLOT}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                aria-label={t("meetings.react")}
                className="rounded-full"
              />
            }
          >
            <SmilePlus aria-hidden />
          </PopoverTrigger>
          <span aria-hidden className={CONTROL_CAPTION}>
            {t("meetings.react")}
          </span>
        </div>
      )}
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
  const mobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });
  const { handRaised, toggleHand } = useMeetingSignals();
  const startRec = useStartRecording(meetingId ?? "");
  const stopRec = useStopRecording(meetingId ?? "");
  const recPending = startRec.isPending || stopRec.isPending;
  const showCaptions = captionsAvailable && Boolean(onToggleCaptions);
  const showRecord = canHost && recordingEnabled && Boolean(meetingId);
  // Phones fit six 44px controls plus Leave; reactions, captions and recording move behind "More".
  const secondaryInMenu = mobile;

  const captionsControl = (inMenu: boolean) =>
    showCaptions ? (
      inMenu ? (
        <MenuControl
          caption={t("meetings.captions")}
          pressed={captionsOn}
          onClick={onToggleCaptions}
        >
          <Captions aria-hidden />
        </MenuControl>
      ) : (
        <LabeledControl
          caption={t("meetings.captions")}
          pressed={captionsOn}
          tone={captionsOn ? "active" : undefined}
          onClick={onToggleCaptions}
        >
          <Captions aria-hidden />
        </LabeledControl>
      )
    ) : null;
  const toggleRecording = () => {
    const m = recording ? stopRec : startRec;
    m.mutate(undefined, { onError: () => toast.error(t("common.error")) });
  };
  const recordControl = (inMenu: boolean) =>
    showRecord ? (
      inMenu ? (
        <MenuControl
          caption={t("meetings.record")}
          pressed={recording}
          disabled={recPending}
          onClick={toggleRecording}
        >
          {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
        </MenuControl>
      ) : (
        <LabeledControl
          caption={t("meetings.record")}
          pressed={recording}
          tone={recording ? "off" : undefined}
          disabled={recPending}
          onClick={toggleRecording}
        >
          {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
        </LabeledControl>
      )
    ) : null;

  return (
    <footer
      className={cn(
        "shrink-0 bg-app-shell px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-4",
        className,
      )}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div />
        <div className="flex min-w-0 items-end justify-center gap-1 sm:gap-2">
          <LabeledControl
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
            caption={t("meetings.hand")}
            pressed={handRaised}
            tone={handRaised ? "active" : undefined}
            onClick={toggleHand}
          >
            <Hand aria-hidden />
          </LabeledControl>
          {secondaryInMenu ? (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <div className={CONTROL_SLOT}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-lg"
                      variant="outline"
                      aria-label={t("meetings.more")}
                      className="rounded-full"
                    />
                  }
                >
                  <MoreHorizontal aria-hidden />
                </PopoverTrigger>
              </div>
              <PopoverContent
                side="top"
                className="flex w-56 flex-col gap-0.5 p-1.5"
              >
                <ReactionsControl inMenu />
                {captionsControl(true)}
                {recordControl(true)}
              </PopoverContent>
            </Popover>
          ) : (
            <>
              <ReactionsControl />
              {captionsControl(false)}
              {recordControl(false)}
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="destructive"
            onClick={onLeave}
            className="size-11 shrink-0 rounded-xl px-0 sm:w-auto sm:px-4"
            aria-label={t("meetings.leave")}
          >
            <PhoneOff aria-hidden />
            <span className="hidden sm:inline">{t("meetings.leave")}</span>
          </Button>
        </div>
      </div>
    </footer>
  );
}
