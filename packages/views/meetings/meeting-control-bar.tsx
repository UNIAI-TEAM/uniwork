"use client";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Captions,
  Circle,
  Hand,
  Lock,
  Mic,
  MicOff,
  MonitorUp,
  Ellipsis,
  PanelBottom,
  PhoneOff,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import { useStartRecording, useStopRecording } from "@uniwork/core/meetings";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import type { Meeting } from "@uniwork/core/types";
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
import type { RoomExit } from "./exit/exit-model";
import { MEETING_DARK_BAR } from "./meeting-dark-bar";
import { MeetingHostLeaveDialog } from "./meeting-host-leave-dialog";
import { MeetingLeaveConfirmDialog } from "./meeting-leave-confirm-dialog";
import { MeetingRecordConfirmDialog } from "./meeting-record-confirm-dialog";
import { roomShortcutLabel, useRoomMediaShortcuts } from "./meeting-room-shortcuts";
import { useOwnMicLock } from "./meeting-moderation";
import { useMeetingSignals } from "./use-meeting-signals";
import { useScreenShareControl } from "./use-screen-share-control";

/** Memoized: the stage hands it stable callbacks, so tile and speaker updates pass it by. */
export const MeetingControlBar = memo(function MeetingControlBar({
  className,
  onExit,
  onEndForAll,
  meetingId,
  canHost = false,
  recordingEnabled = false,
  recording = false,
  captionsOn = false,
  captionsAvailable = false,
  onToggleCaptions,
  hostLeave,
}: {
  className?: string;
  /** Leaving hands back how the mic and camera were, so "Vào lại" restores them. */
  onExit: (exit: RoomExit) => void;
  onEndForAll?: () => void;
  meetingId?: string;
  canHost?: boolean;
  /** Set for a host or admin of a live meeting: Leave then asks how, not just whether. Keep it memoized. */
  hostLeave?: { meeting: Meeting; workspaceId: string };
  recordingEnabled?: boolean;
  recording?: boolean;
  captionsOn?: boolean;
  captionsAvailable?: boolean;
  onToggleCaptions?: () => void;
}) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [recordConfirmOpen, setRecordConfirmOpen] = useState(false);
  const controlBarAutoHide = useMeetingRoomPreferencesStore((s) => s.controlBarAutoHide);
  const setControlBarAutoHide = useMeetingRoomPreferencesStore((s) => s.setControlBarAutoHide);
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const micLock = useOwnMicLock();
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useScreenShareControl();
  const { handRaised, toggleHand } = useMeetingSignals();
  useRoomMediaShortcuts({
    onToggleMic: () => {
      if (micLock.locked) micLock.explain();
      else if (!mic.pending) void mic.toggle();
    },
    onToggleCamera: () => {
      if (!camera.pending) void camera.toggle();
    },
  });
  const micTooltip = micLock.locked
    ? t("meetings.micLockedYou")
    : t("meetings.shortcutHint", {
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
    !screen.supported ? null : inMenu ? (
      <MenuControl caption={screen.label} pressed={screen.enabled} busy={screen.pending} onClick={screen.toggle}>
        {screen.locked ? <Lock aria-hidden /> : <MonitorUp aria-hidden />}
      </MenuControl>
    ) : (
      <IconControl
        // Locked like the mic: named so, and a click explains (useScreenShareControl).
        label={screen.label}
        tooltip={screen.locked ? t("meetings.shareLockedYou") : undefined}
        pressed={screen.enabled}
        tone={screen.enabled ? "active" : undefined}
        busy={screen.pending}
        onClick={screen.toggle}
      >
        {screen.locked ? <Lock aria-hidden /> : <MonitorUp aria-hidden />}
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
        <MenuControl caption={recordLabel} busy={recPending} onClick={toggleRecording}>
          {recording ? <Square aria-hidden /> : <Circle aria-hidden />}
        </MenuControl>
      ) : (
        <IconControl
          label={recordLabel}
          tone={recording ? "off" : undefined}
          busy={recPending}
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
                // The lock is part of the name: a tooltip and a passing toast
                // never reach a screen reader that lands on the button later.
                label={micLock.locked ? t("meetings.micLockedControl") : t("meetings.mic")}
                tooltip={micTooltip}
                pressed={mic.enabled}
                tone={mic.enabled ? "active" : "off"}
                busy={mic.pending}
                onClick={() => {
                  // Locked: say why instead of a toggle LiveKit refuses.
                  if (micLock.locked) micLock.explain();
                  else void mic.toggle();
                }}
              >
                {micLock.locked ? <Lock aria-hidden /> : mic.enabled ? <Mic aria-hidden /> : <MicOff aria-hidden />}
              </IconControl>
              <IconControl
                label={t("meetings.camera")}
                tooltip={cameraTooltip}
                pressed={camera.enabled}
                tone={camera.enabled ? "active" : "off"}
                busy={camera.pending}
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
                    <Ellipsis aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="dark">{t("meetings.more")}</TooltipContent>
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
              <TooltipContent side="top" className="dark">{t("meetings.leave")}</TooltipContent>
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
      {hostLeave ? (
        <MeetingHostLeaveDialog
          open={leaveConfirmOpen}
          onOpenChange={setLeaveConfirmOpen}
          meeting={hostLeave.meeting}
          workspaceId={hostLeave.workspaceId}
          recording={recording}
          media={{ audio: mic.enabled, video: camera.enabled }}
          onExit={(next) => {
            setLeaveConfirmOpen(false);
            onExit(next);
          }}
          onEndForAll={() => {
            setLeaveConfirmOpen(false);
            onEndForAll?.();
          }}
        />
      ) : (
        <MeetingLeaveConfirmDialog
          open={leaveConfirmOpen}
          onOpenChange={setLeaveConfirmOpen}
          onConfirm={() => {
            setLeaveConfirmOpen(false);
            onExit({ kind: "left", media: { audio: mic.enabled, video: camera.enabled } });
          }}
        />
      )}
    </>
  );
});
