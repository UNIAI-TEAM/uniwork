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
  MEETING_CHIP,
  MenuControl,
  ReactionsControl,
} from "./meeting-control-bar-controls";
import { MEETING_DARK_BAR } from "./meeting-dark-bar";
import { MeetingLeaveConfirmDialog } from "./meeting-leave-confirm-dialog";
import { MeetingRecordConfirmDialog } from "./meeting-record-confirm-dialog";
import { roomShortcutLabel, useRoomMediaShortcuts } from "./meeting-room-shortcuts";
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
  onToggleCopilot,
  copilotActive = false,
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
  /** Opens the AI Copilot panel, or closes it when it is the one on screen. */
  onToggleCopilot?: () => void;
  copilotActive?: boolean;
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
  useRoomMediaShortcuts({
    onToggleMic: () => {
      if (!mic.pending) void mic.toggle();
    },
    onToggleCamera: () => {
      if (!camera.pending) void camera.toggle();
    },
  });
  const micTooltip = t("meetings.shortcutHint", {
    action: mic.enabled ? t("meetings.micOff") : t("meetings.micOn"),
    keys: roomShortcutLabel("D"),
  });
  const cameraTooltip = t("meetings.shortcutHint", {
    action: camera.enabled ? t("meetings.cameraOff") : t("meetings.cameraOn"),
    keys: roomShortcutLabel("E"),
  });
  const startRec = useStartRecording(meetingId ?? "");
  const stopRec = useStopRecording(meetingId ?? "");
  const recPending = startRec.isPending || stopRec.isPending;
  const showCaptions = captionsAvailable && Boolean(onToggleCaptions);
  const showRecord = canHost && recordingEnabled && Boolean(meetingId);
  // A phone keeps five chips on the bar (mic, camera, AI, more, leave); the
  // rest fold into "More" so the bar fits a 375px screen without scrolling.
  const secondaryInMenu = mobile;
  // While recording, the control names what pressing it does next.
  const recordLabel = recording ? t("meetings.stopRecording") : t("meetings.record");

  const toggleRecording = () => {
    if (recording) {
      stopRec.mutate(undefined, {
        onError: (err) => toastApiError(err, t("common.error")),
        onSuccess: () =>
          toast.success(t("meetings.recordingStopped"), {
            description: t("meetings.recordingStoppedHint"),
          }),
      });
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

  const shareControl = (inMenu: boolean) =>
    inMenu ? (
      <MenuControl
        caption={t("meetings.share")}
        pressed={screen.enabled}
        disabled={screen.pending}
        onClick={() => {
          void screen.toggle();
        }}
      >
        <MonitorUp aria-hidden />
      </MenuControl>
    ) : (
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
    );

  const handControl = (inMenu: boolean) =>
    inMenu ? (
      <MenuControl caption={t("meetings.hand")} pressed={handRaised} onClick={toggleHand}>
        <Hand aria-hidden />
      </MenuControl>
    ) : (
      <IconControl
        label={t("meetings.hand")}
        pressed={handRaised}
        tone={handRaised ? "active" : undefined}
        onClick={toggleHand}
      >
        <Hand aria-hidden />
      </IconControl>
    );

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

  const recordControl = (inMenu: boolean) =>
    showRecord ? (
      inMenu ? (
        <MenuControl caption={recordLabel} disabled={recPending} onClick={toggleRecording}>
          {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
        </MenuControl>
      ) : (
        <IconControl
          label={recordLabel}
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
      {secondaryInMenu ? (
        <>
          {shareControl(true)}
          {handControl(true)}
          <DeviceSettingsControl inMenu />
        </>
      ) : null}
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

  return (
    <>
      <div className={className}>
        <TooltipProvider delay={300}>
          <div className={cn(MEETING_DARK_BAR, "w-fit max-w-full")}>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-1.5">
              <IconControl
                label={t("meetings.mic")}
                tooltip={micTooltip}
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
                tooltip={cameraTooltip}
                pressed={camera.enabled}
                tone={camera.enabled ? "active" : "off"}
                disabled={camera.pending}
                onClick={() => {
                  void camera.toggle();
                }}
              >
                {camera.enabled ? <Video aria-hidden /> : <VideoOff aria-hidden />}
              </IconControl>
              {!secondaryInMenu ? (
                <>
                  {shareControl(false)}
                  <DeviceSettingsControl />
                  {handControl(false)}
                </>
              ) : null}
              {onToggleCopilot ? (
                <IconControl
                  label={t("meetings.aiCopilot")}
                  tooltip={copilotActive ? t("meetings.aiCopilotClose") : t("meetings.aiCopilotToggle")}
                  pressed={copilotActive}
                  tone={copilotActive ? "active" : undefined}
                  onClick={onToggleCopilot}
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
                            variant="meetingChip"
                            aria-label={t("meetings.more")}
                            className={MEETING_CHIP}
                          />
                        }
                      />
                    }
                  >
                    <MoreHorizontal aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("meetings.more")}</TooltipContent>
                </Tooltip>
                {/* `dark`, like the admit-guests card: the popup portals out of the dark stage. */}
                <PopoverContent side="top" className="dark flex w-56 flex-col gap-0.5 p-1.5">
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
                    variant="destructiveSolid"
                    size="icon-lg"
                    onClick={() => setLeaveConfirmOpen(true)}
                    aria-label={t("meetings.leave")}
                    className={MEETING_CHIP}
                  />
                }
              >
                <PhoneOff aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="top">{t("meetings.leave")}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
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
}
