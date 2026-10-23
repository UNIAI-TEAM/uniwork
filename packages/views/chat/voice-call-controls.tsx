"use client";

import { useState } from "react";
import { Mic, MicOff, MonitorUp, Phone, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { CHAT_CONFIRM_CLASS } from "./chat-confirm-look";
import { roomShortcutLabel } from "../meetings/meeting-room-shortcuts";
import type { VoiceCallRecordingState } from "./use-voice-call-recording";
import { VoiceCallControl } from "./voice-call-control";
import { VoiceCallHangupIcon } from "./voice-call-floating-panel";
import { isMultiPartyVoiceCall, voiceCallPrimaryLeaveEndsForAll } from "./voice-call-kind-utils";
import type { VoiceCallKind } from "./voice-call-overlay-types";
import { VoiceCallRecordControl } from "./voice-call-recording-controls";
import { useVoiceCallActions, useVoiceCallStatus } from "./voice-call-room-context";

/** Ctrl/⌘+D and Ctrl/⌘+E, the meeting room's shortcuts (useRoomMediaShortcuts). */
const MIC_KEYS = "Control+D Meta+D";
const CAMERA_KEYS = "Control+E Meta+E";

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
        <VoiceCallHangupIcon className="size-4.5" />
      </Button>
    );
  }

  const micLabel = t("chat.voice_call_mic");
  const cameraLabel = t("chat.voice_call_camera");

  return (
    <div className={cn("flex flex-col items-center", large ? "w-full" : "gap-3")}>
      <div className={cn("flex flex-wrap items-center justify-center", large ? "gap-2" : "gap-3")}>
        {/* Device failures surface as the notice above the stage; the
            controls only show the state LiveKit reports back. */}
        <VoiceCallControl
          label={micLabel}
          shortcut={roomShortcutLabel("D")}
          keyShortcuts={MIC_KEYS}
          pressed={!muted}
          tone={muted ? "off" : "default"}
          large={large}
          disabled={!connected}
          onClick={() => void toggleMute()}
        >
          {muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
        </VoiceCallControl>
        <VoiceCallControl
          label={cameraLabel}
          shortcut={roomShortcutLabel("E")}
          keyShortcuts={CAMERA_KEYS}
          pressed={cameraEnabled}
          tone={cameraEnabled ? "on" : "default"}
          large={large}
          disabled={!connected}
          onClick={() => void toggleCamera()}
        >
          {cameraEnabled ? <Video aria-hidden /> : <VideoOff aria-hidden />}
        </VoiceCallControl>
        <VoiceCallControl
          label={t("chat.voice_call_screen_share")}
          pressed={screenShareEnabled}
          tone={screenShareEnabled ? "on" : "default"}
          large={large}
          disabled={!connected}
          onClick={handleToggleScreenShare}
        >
          <MonitorUp aria-hidden />
        </VoiceCallControl>
        <VoiceCallRecordControl recording={recording} disabled={!connected} large={large} />
        <VoiceCallControl label={leaveLabel} tone="hangup" large={large} onClick={handleLeave}>
          <VoiceCallHangupIcon />
        </VoiceCallControl>
      </div>
      {/* Ending for everyone is rarer and heavier than leaving: a named
          text action under the row (beside it fullscreen), and it asks first. */}
      {multiParty && isCaller ? (
        <>
          <Button
            type="button"
            variant="destructive"
            className={cn(
              "rounded-full font-semibold",
              large
                ? "mt-3 h-11 px-4.5 text-body lg:absolute lg:top-1/2 lg:right-6 lg:mt-0 lg:-translate-y-1/2"
                : "h-8.5 px-4 text-label",
            )}
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
            icon={Phone}
            solid
            cancelVariant="secondary"
            // The tile's handset turned down: the hang-up glyph.
            className={cn(CHAT_CONFIRM_CLASS, "[&_.lucide-phone]:rotate-[135deg]")}
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
