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
import { isMultiPartyVoiceCall } from "./voice-call-kind-utils";
import type { VoiceCallKind } from "./voice-call-overlay-types";
import { VoiceCallRecordControl } from "./voice-call-recording-controls";
import { useVoiceCallActions, useVoiceCallStatus } from "./voice-call-room-context";

/** Solid hang-up red with the on-solid glyph: the one control that ends something. */
const HANG_UP = "border-transparent bg-destructive-solid text-on-solid hover:bg-destructive-solid hover:opacity-90";

/** Ctrl/⌘+D and Ctrl/⌘+E, the meeting room's shortcuts (useRoomMediaShortcuts). */
const MIC_KEYS = "Control+D Meta+D";
const CAMERA_KEYS = "Control+E Meta+E";

/**
 * One call control, the same shape as the meeting room's: a fixed label (it
 * names the device, not the next action), `aria-pressed` for its state, and
 * the name again as a tooltip. `off` is a device the user has turned off
 * (mic muted) and reads in the danger soft pair; `on` is a device that is
 * live (camera, screen share) and reads as the brand wash.
 */
function VoiceCallRoundControl({
  ariaLabel,
  tooltip,
  keyShortcuts,
  onClick,
  disabled,
  pressed,
  tone = "default",
  children,
}: {
  ariaLabel: string;
  tooltip?: string;
  keyShortcuts?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  tone?: "default" | "on" | "off" | "hangup";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className={cn(
              "size-11 rounded-xl",
              tone === "on" && "border-transparent bg-brand-subtle text-brand-subtle-foreground hover:bg-brand-subtle",
              tone === "off" &&
                "border-transparent bg-destructive-soft text-destructive-soft-foreground hover:bg-destructive-soft",
              tone === "hangup" && HANG_UP,
            )}
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
}: {
  callKind: VoiceCallKind;
  isCaller: boolean;
  recording: VoiceCallRecordingState;
  onLeave: () => void;
  onEndForAll: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { connected, muted, cameraEnabled, screenShareEnabled, remoteParticipantCount } = useVoiceCallStatus();
  const { toggleMute, toggleCamera, toggleScreenShare } = useVoiceCallActions();
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const multiParty = isMultiPartyVoiceCall(callKind);

  const handleToggleScreenShare = () => {
    void toggleScreenShare().then((ok) => {
      if (!ok) toast.error(t("chat.voice_call_screen_share_failed"));
    });
  };

  const handleLeave = () => {
    if (callKind === "dm" || (multiParty && isCaller && remoteParticipantCount === 0)) {
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
        size="icon-lg"
        className={cn("shrink-0 rounded-full", HANG_UP)}
        aria-label={leaveLabel}
        title={leaveLabel}
        onClick={handleLeave}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PhoneOff aria-hidden className="size-4" />
      </Button>
    );
  }

  const micLabel = t("chat.voice_call_mic");
  const cameraLabel = t("chat.voice_call_camera");

  return (
    <div className="flex flex-col items-center gap-2">
      <VoiceCallControlRow>
        {/* Device failures surface as the notice above the stage; the
            controls only show the state LiveKit reports back. */}
        <VoiceCallRoundControl
          ariaLabel={micLabel}
          tooltip={t("meetings.shortcutHint", { action: micLabel, keys: roomShortcutLabel("D") })}
          keyShortcuts={MIC_KEYS}
          pressed={!muted}
          tone={muted ? "off" : "default"}
          disabled={!connected}
          onClick={() => void toggleMute()}
        >
          {muted ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
        </VoiceCallRoundControl>
        <VoiceCallRoundControl
          ariaLabel={cameraLabel}
          tooltip={t("meetings.shortcutHint", { action: cameraLabel, keys: roomShortcutLabel("E") })}
          keyShortcuts={CAMERA_KEYS}
          pressed={cameraEnabled}
          tone={cameraEnabled ? "on" : "default"}
          disabled={!connected}
          onClick={() => void toggleCamera()}
        >
          {cameraEnabled ? <Video aria-hidden className="size-4" /> : <VideoOff aria-hidden className="size-4" />}
        </VoiceCallRoundControl>
        <VoiceCallRoundControl
          ariaLabel={t("chat.voice_call_screen_share")}
          pressed={screenShareEnabled}
          tone={screenShareEnabled ? "on" : "default"}
          disabled={!connected}
          onClick={handleToggleScreenShare}
        >
          <MonitorUp aria-hidden className="size-4" />
        </VoiceCallRoundControl>
        <VoiceCallRecordControl recording={recording} disabled={!connected} />
        <VoiceCallRoundControl ariaLabel={leaveLabel} tone="hangup" onClick={handleLeave}>
          <PhoneOff aria-hidden className="size-4" />
        </VoiceCallRoundControl>
      </VoiceCallControlRow>
      {/* Ending for everyone is rarer and heavier than leaving: a named
          text action under the row, and it asks first. */}
      {multiParty && isCaller ? (
        <>
          <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmEndOpen(true)}>
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
