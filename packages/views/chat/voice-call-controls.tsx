"use client";

import { useState, type ReactNode } from "react";
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { roomShortcutLabel } from "../meetings/meeting-room-shortcuts";
import type { VoiceCallRecordingState } from "./use-voice-call-recording";
import { VoiceCallControlRow } from "./voice-call-floating-panel";
import { isMultiPartyVoiceCall, voiceCallPrimaryLeaveEndsForAll } from "./voice-call-kind-utils";
import type { VoiceCallKind } from "./voice-call-overlay-types";
import { VoiceCallRecordControl } from "./voice-call-recording-controls";
import { useVoiceCallActions, useVoiceCallStatus } from "./voice-call-room-context";

/**
 * Round controls on the dark call plane. Neutral is the meeting bar's chip;
 * `on` (camera, screen share live) is the brand fill; `off` (mic muted) is the
 * light fill, so a muted mic stands out from the row; hang-up is the solid red
 * with the on-solid glyph — the one control that ends something.
 */
const TONE_VARIANT = {
  default: "meetingChip",
  on: "default",
  off: "default",
  hangup: "destructiveSolid",
} as const;
const TONE_CLASS = {
  default: "border-transparent",
  on: "hover:bg-primary/90",
  off: "bg-foreground text-background hover:bg-foreground/90",
  hangup: "",
} as const;
/** 52px in the panel, 56px fullscreen; both clear the 44px target. */
const ROUND_SIZE = { panel: "size-13 rounded-full", large: "size-14 rounded-full" } as const;

/** Ctrl/⌘+D and Ctrl/⌘+E, the meeting room's shortcuts (useRoomMediaShortcuts). */
const MIC_KEYS = "Control+D Meta+D";
const CAMERA_KEYS = "Control+E Meta+E";

/**
 * One call control, the same shape as the meeting room's: a fixed label (it
 * names the device, not the next action), `aria-pressed` for its state, and
 * the name again as a tooltip.
 */
function VoiceCallRoundControl({
  ariaLabel,
  tooltip,
  keyShortcuts,
  onClick,
  disabled,
  pressed,
  tone = "default",
  sizeClass,
  children,
}: {
  ariaLabel: string;
  tooltip?: string;
  keyShortcuts?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  tone?: keyof typeof TONE_VARIANT;
  sizeClass: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={TONE_VARIANT[tone]}
            size="icon"
            className={cn(sizeClass, TONE_CLASS[tone])}
            aria-label={ariaLabel}
            aria-pressed={pressed}
            aria-keyshortcuts={keyShortcuts}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? ariaLabel}</TooltipContent>
    </Tooltip>
  );
}

export function ActiveVoiceControls({
  callKind,
  isCaller,
  recording,
  onLeave,
  onEndForAll,
  compact,
  large,
}: {
  callKind: VoiceCallKind;
  isCaller: boolean;
  recording: VoiceCallRecordingState;
  onLeave: () => void;
  onEndForAll: () => void;
  compact?: boolean;
  /** Fullscreen: the bigger round buttons. */
  large?: boolean;
}) {
  const { t } = useTranslation();
  const { connected, muted, cameraEnabled, screenShareEnabled } = useVoiceCallStatus();
  const { toggleMute, toggleCamera, toggleScreenShare } = useVoiceCallActions();
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const multiParty = isMultiPartyVoiceCall(callKind);

  const handleToggleScreenShare = () => {
    void toggleScreenShare().then((ok) => {
      if (!ok) toast.error(t("chat.voice_call_screen_share_failed"));
    });
  };

  const handleLeave = () => {
    if (voiceCallPrimaryLeaveEndsForAll(callKind, isCaller)) {
      onEndForAll();
      return;
    }
    onLeave();
  };

  const leaveLabel = multiParty ? t("chat.voice_call_leave") : t("chat.voice_call_end");

  if (compact) {
    return (
      <Button
        type="button"
        variant="destructiveSolid"
        size="icon"
        className="size-11 shrink-0 rounded-full"
        aria-label={leaveLabel}
        title={leaveLabel}
        onClick={handleLeave}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PhoneOff aria-hidden className="size-4.5" />
      </Button>
    );
  }

  const sizeClass = large ? ROUND_SIZE.large : ROUND_SIZE.panel;
  const micLabel = t("chat.voice_call_mic");
  const cameraLabel = t("chat.voice_call_camera");

  return (
    <div className="flex flex-col items-center gap-3">
      <VoiceCallControlRow>
        {/* Device failures surface as the notice above the stage; the
            controls only show the state LiveKit reports back. */}
        <VoiceCallRoundControl
          ariaLabel={micLabel}
          tooltip={t("meetings.shortcutHint", { action: micLabel, keys: roomShortcutLabel("D") })}
          keyShortcuts={MIC_KEYS}
          pressed={!muted}
          tone={muted ? "off" : "default"}
          sizeClass={sizeClass}
          disabled={!connected}
          onClick={() => void toggleMute()}
        >
          {muted ? <MicOff aria-hidden className="size-5" /> : <Mic aria-hidden className="size-5" />}
        </VoiceCallRoundControl>
        <VoiceCallRoundControl
          ariaLabel={cameraLabel}
          tooltip={t("meetings.shortcutHint", { action: cameraLabel, keys: roomShortcutLabel("E") })}
          keyShortcuts={CAMERA_KEYS}
          pressed={cameraEnabled}
          tone={cameraEnabled ? "on" : "default"}
          sizeClass={sizeClass}
          disabled={!connected}
          onClick={() => void toggleCamera()}
        >
          {cameraEnabled ? <Video aria-hidden className="size-5" /> : <VideoOff aria-hidden className="size-5" />}
        </VoiceCallRoundControl>
        <VoiceCallRoundControl
          ariaLabel={t("chat.voice_call_screen_share")}
          pressed={screenShareEnabled}
          tone={screenShareEnabled ? "on" : "default"}
          sizeClass={sizeClass}
          disabled={!connected}
          onClick={handleToggleScreenShare}
        >
          <MonitorUp aria-hidden className="size-5" />
        </VoiceCallRoundControl>
        <VoiceCallRecordControl recording={recording} disabled={!connected} className={sizeClass} />
        <VoiceCallRoundControl ariaLabel={leaveLabel} tone="hangup" sizeClass={sizeClass} onClick={handleLeave}>
          <PhoneOff aria-hidden className="size-5" />
        </VoiceCallRoundControl>
      </VoiceCallControlRow>
      {/* Ending for everyone is rarer and heavier than leaving: a named
          text action under the row, and it asks first. */}
      {multiParty && isCaller ? (
        <>
          <Button
            type="button"
            variant="destructive"
            className="h-9 rounded-full px-4 font-semibold"
            onClick={() => setConfirmEndOpen(true)}
          >
            {t("chat.voice_call_end_for_all")}
          </Button>
          <ConfirmDialog
            open={confirmEndOpen}
            onOpenChange={setConfirmEndOpen}
            title={t("chat.voice_call_end_for_all_confirm_title")}
            description={t("chat.voice_call_end_for_all_confirm")}
            confirmLabel={t("chat.voice_call_end_for_all")}
            onConfirm={() => {
              setConfirmEndOpen(false);
              onEndForAll();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
