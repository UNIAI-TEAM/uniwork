"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { VoiceCallFace, useVoiceCallFaceIsSquare } from "./voice-call-face";
import { VOICE_CALL_STAGE, VoiceCallGroupVideoStage, VoiceCallNamePlate } from "./voice-call-group-video-stage";
import { isMultiPartyVoiceCall } from "./voice-call-kind-utils";
import type { VoiceCallKind } from "./voice-call-overlay-types";
import { useVoiceCallMedia, useVoiceCallStatus } from "./voice-call-room-context";

/* Two staggered rings on a slow 1.8s swell while the other person talks. */
const PULSE_DELAYS = ["0s", "0.9s"] as const;

/** "UNI sẽ tóm tắt vào chat sau cuộc gọi": the AI will post a summary when the call ends. */
export function VoiceCallSummaryHint({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn("flex items-center gap-2 bg-meeting-bar-chip-bg text-label text-foreground/90", className)}>
      <Sparkles aria-hidden className="size-3.5 shrink-0 text-call-speaking" />
      {t("chat.voice_call_ai_summary_hint")}
    </p>
  );
}

/** The 1-1 voice face: the speaking ring and its swell while the other person talks. */
function VoiceFace({ peerName, speaking }: { peerName: string; speaking?: boolean }) {
  const shape = useVoiceCallFaceIsSquare() ? "rounded-[24px]" : "rounded-full";
  return (
    <div className="relative flex size-37 items-center justify-center">
      {speaking
        ? PULSE_DELAYS.map((delay) => (
            <span
              key={delay}
              aria-hidden
              // Ping swells to twice its size: from 80px it ends at the 1.35× of the 120px face.
              className={cn("absolute inset-8.5 border-3 border-call-ring/70 motion-safe:animate-ping motion-reduce:hidden", shape)}
              style={{ animationDuration: "1.8s", animationDelay: delay }}
            />
          ))
        : null}
      <VoiceCallFace
        peerName={peerName}
        size="xl"
        className={cn(
          "transition-shadow duration-(--duration-fast)",
          speaking && "ring-3 ring-call-ring ring-offset-4 ring-offset-call-plane",
        )}
      />
    </div>
  );
}

/** The 1-1 stage: the other person large, you in the corner, each named. */
export function VoiceCallVideoStage({
  peerName,
  callKind,
  size = "compact",
  aiSummary = false,
}: {
  peerName: string;
  callKind: VoiceCallKind;
  size?: "compact" | "fullscreen";
  /** The workspace's AI will summarise the call into the chat: say so under the face. */
  aiSummary?: boolean;
}) {
  const { t } = useTranslation();
  const { cameraEnabled, screenShareEnabled, muted } = useVoiceCallStatus();
  const {
    remoteCameraEnabled,
    remoteScreenShareEnabled,
    participantTiles,
    bindLocalVideo,
    bindRemoteVideo,
    bindLocalScreenShare,
    bindRemoteScreenShare,
    bindParticipantVideo,
    bindParticipantScreenShare,
  } = useVoiceCallMedia();
  const fullscreen = size === "fullscreen";

  if (isMultiPartyVoiceCall(callKind)) {
    return (
      <VoiceCallGroupVideoStage
        tiles={participantTiles}
        youLabel={t("chat.you")}
        size={size}
        bindParticipantVideo={bindParticipantVideo}
        bindParticipantScreenShare={bindParticipantScreenShare}
      />
    );
  }

  const hasScreenShare = screenShareEnabled || remoteScreenShareEnabled;
  const showRemoteScreenShare = remoteScreenShareEnabled;
  const showLocalScreenShare = screenShareEnabled && !remoteScreenShareEnabled;
  const remoteTile = participantTiles.find((tile) => !tile.isLocal);
  // The big frame shows the peer (or a shared screen). When only our own
  // camera is on, our video takes the whole frame instead of hiding behind
  // the peer's avatar.
  const remoteFillsStage = remoteCameraEnabled || hasScreenShare;

  if (!cameraEnabled && !remoteFillsStage) {
    if (fullscreen) {
      return (
        <div className={cn(VOICE_CALL_STAGE, "flex flex-col items-center justify-center gap-4 text-center")}>
          <VoiceFace peerName={peerName} speaking={remoteTile?.isSpeaking} />
          <p className="truncate font-display text-title-lg font-bold text-foreground">{peerName}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center pt-3 pb-2 text-center">
        <VoiceFace peerName={peerName} speaking={remoteTile?.isSpeaking} />
        {aiSummary ? <VoiceCallSummaryHint className="mt-4.5 rounded-2xl px-3 py-1.75" /> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-call-stage",
        fullscreen ? cn(VOICE_CALL_STAGE, "flex-1") : "aspect-video rounded-[14px]",
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- LiveKit realtime video has no caption track */}
      <video
        ref={showRemoteScreenShare ? bindRemoteScreenShare : showLocalScreenShare ? bindLocalScreenShare : bindRemoteVideo}
        autoPlay
        playsInline
        className={cn(
          "size-full",
          hasScreenShare ? "object-contain" : "object-cover",
          !remoteFillsStage && "hidden",
        )}
      />
      {remoteFillsStage ? (
        <VoiceCallNamePlate
          name={peerName}
          micMuted={remoteTile?.micMuted}
          className={cn("bottom-2 left-2 px-2 py-0.75", cameraEnabled && "max-w-[calc(100%-7.75rem)]")}
        />
      ) : null}
      {cameraEnabled ? (
        <div
          className={cn(
            "overflow-hidden",
            remoteFillsStage
              ? fullscreen
                ? "absolute right-4 bottom-4 h-28 w-40 rounded-xl border border-call-muted-foreground/30 shadow-lg sm:h-36 sm:w-52"
                : "absolute right-2 bottom-2 h-16 w-24 rounded-[10px] border border-call-muted-foreground/30 shadow-lg"
              : "absolute inset-0",
          )}
        >
          <video ref={bindLocalVideo} autoPlay playsInline muted className="size-full scale-x-[-1] object-cover" />
          <VoiceCallNamePlate
            name={t("chat.you")}
            micMuted={muted}
            className={remoteFillsStage && !fullscreen ? "bottom-1 left-1 rounded-[5px] px-1.5 py-px text-micro" : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
