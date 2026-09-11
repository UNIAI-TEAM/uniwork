"use client";
import { useState } from "react";
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
  PanelBottom,
  PhoneOff,
  Sparkles,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import { useStartRecording, useStopRecording } from "@uniwork/core/meetings";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { Button } from "@uniwork/ui/components/ui/button";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";
import {
  AdjustViewControl,
  DeviceSettingsControl,
  IconControl,
  MenuControl,
  ReactionsControl,
  SOLID_DESTRUCTIVE,
} from "./meeting-control-bar-controls";
import { MEETING_DARK_BAR, MEETING_DARK_BAR_CHIP } from "./meeting-dark-bar";
import { MeetingLeaveConfirmDialog } from "./meeting-leave-confirm-dialog";
import { MeetingRecordConfirmDialog } from "./meeting-record-confirm-dialog";
import { useMeetingSignals } from "./use-meeting-signals";

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
  onOpenCopilot,
  copilotActive = false,
  floating = false,
  embedded = false,
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
  onOpenCopilot?: () => void;
  copilotActive?: boolean;
  floating?: boolean;
  /** Rendered inside MeetingStageFooter without its own footer shell. */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [recordConfirmOpen, setRecordConfirmOpen] = useState(false);
  const controlBarAutoHide = useMeetingRoomPreferencesStore((s) => s.controlBarAutoHide);
  const setControlBarAutoHide = useMeetingRoomPreferencesStore((s) => s.setControlBarAutoHide);
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });
  const { handRaised, toggleHand } = useMeetingSignals();
  const startRec = useStartRecording(meetingId ?? "");
  const stopRec = useStopRecording(meetingId ?? "");
  const recPending = startRec.isPending || stopRec.isPending;
  const showCaptions = captionsAvailable && Boolean(onToggleCaptions);
  const showRecord = canHost && recordingEnabled && Boolean(meetingId);
  const secondaryInMenu = mobile;

  const captionsControl = (inMenu: boolean) =>
    showCaptions ? (
      inMenu ? (
        <MenuControl caption={t("meetings.captions")} pressed={captionsOn} onClick={onToggleCaptions}>
          <Captions aria-hidden />
        </MenuControl>
      ) : (
        <IconControl
          label={t("meetings.captions")}
          pressed={captionsOn}
          tone={captionsOn ? "active" : undefined}
          onClick={onToggleCaptions}
        >
          <Captions aria-hidden />
        </IconControl>
      )
    ) : null;

  const toggleRecording = () => {
    if (recording) {
      stopRec.mutate(undefined, { onError: (err) => toastApiError(err, t("common.error")) });
      return;
    }
    setRecordConfirmOpen(true);
  };

  const confirmStartRecording = () => {
    startRec.mutate(undefined, {
      onError: (err) => toastApiError(err, t("common.error")),
      onSuccess: () => toast.success(t("meetings.recordingStarted")),
    });
    setRecordConfirmOpen(false);
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
        <IconControl
          label={t("meetings.record")}
          pressed={recording}
          tone={recording ? "off" : undefined}
          disabled={recPending}
          onClick={toggleRecording}
        >
          {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
        </IconControl>
      )
    ) : null;

  const moreMenu = (
    <>
      {secondaryInMenu ? <DeviceSettingsControl inMenu /> : null}
      <ReactionsControl inMenu />
      <AdjustViewControl inMenu />
      <MenuControl
        caption={t("meetings.controlBarAutoHide")}
        pressed={controlBarAutoHide}
        onClick={() => setControlBarAutoHide(!controlBarAutoHide)}
      >
        <PanelBottom aria-hidden />
      </MenuControl>
      {secondaryInMenu ? (
        <>
          {captionsControl(true)}
          {recordControl(true)}
        </>
      ) : null}
    </>
  );

  const bar = (
    <TooltipProvider delay={300}>
      <div
        className={cn(
          MEETING_DARK_BAR,
          embedded || floating
            ? "w-fit"
            : "w-full max-w-none border-0 bg-transparent p-0 shadow-none backdrop-blur-none",
          !embedded && floating && "max-w-3xl",
        )}
      >
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-1.5">
            <IconControl
              label={t("meetings.mic")}
              pressed={mic.enabled}
              tone={mic.enabled ? "active" : "off"}
              disabled={mic.pending}
              onClick={() => {
                void mic.toggle();
              }}
            >
              {mic.enabled ? <Mic aria-hidden /> : <MicOff aria-hidden />}
            </IconControl>
            <IconControl
              label={t("meetings.camera")}
              pressed={camera.enabled}
              tone={camera.enabled ? "active" : "off"}
              disabled={camera.pending}
              onClick={() => {
                void camera.toggle();
              }}
            >
              {camera.enabled ? <Video aria-hidden /> : <VideoOff aria-hidden />}
            </IconControl>
            <IconControl
              label={t("meetings.share")}
              pressed={screen.enabled}
              tone={screen.enabled ? "active" : undefined}
              disabled={screen.pending}
              onClick={() => {
                void screen.toggle();
              }}
            >
              <MonitorUp aria-hidden />
            </IconControl>
            {!secondaryInMenu ? <DeviceSettingsControl /> : null}
            <IconControl
              label={t("meetings.hand")}
              pressed={handRaised}
              tone={handRaised ? "active" : undefined}
              onClick={toggleHand}
            >
              <Hand aria-hidden />
            </IconControl>
            {onOpenCopilot ? (
              <IconControl
                label={t("meetings.aiCopilotToggle")}
                pressed={copilotActive}
                tone={copilotActive ? "copilot" : undefined}
                onClick={onOpenCopilot}
              >
                <Sparkles aria-hidden />
              </IconControl>
            ) : null}
            {!secondaryInMenu ? (
              <>
                {captionsControl(false)}
                {recordControl(false)}
              </>
            ) : null}
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-lg"
                          variant="outline"
                          aria-label={t("meetings.more")}
                          className={MEETING_DARK_BAR_CHIP}
                        />
                      }
                    />
                  }
                >
                  <MoreHorizontal aria-hidden />
                </TooltipTrigger>
                <TooltipContent side="top">{t("meetings.more")}</TooltipContent>
              </Tooltip>
              <PopoverContent side="top" className="flex w-56 flex-col gap-0.5 p-1.5">
                {moreMenu}
              </PopoverContent>
            </Popover>
          </div>

          <span aria-hidden className="mx-0.5 h-8 w-px shrink-0 bg-meeting-bar-border" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  onClick={() => setLeaveConfirmOpen(true)}
                  aria-label={t("meetings.leave")}
                  className={cn(MEETING_DARK_BAR_CHIP, SOLID_DESTRUCTIVE)}
                />
              }
            >
              <PhoneOff aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="top">{t("meetings.leave")}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
  );

  const dialogs = (
    <>
      <MeetingRecordConfirmDialog
        open={recordConfirmOpen}
        pending={startRec.isPending}
        onOpenChange={setRecordConfirmOpen}
        onConfirm={confirmStartRecording}
      />
      <MeetingLeaveConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          onLeave();
        }}
      />
    </>
  );

  if (embedded) {
    return (
      <>
        <div className={className}>{bar}</div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <footer
        className={cn(
          floating
            ? "pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:bottom-4"
            : "shrink-0 bg-app-shell px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-4",
          className,
        )}
      >
        {bar}
      </footer>
      {dialogs}
    </>
  );
}
