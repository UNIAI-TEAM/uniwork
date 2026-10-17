"use client";

import { MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { voiceCallInitialOf } from "./voice-call-floating-panel";
import { VOICE_CALL_NAME_PLATE, VoiceCallGroupVideoStage } from "./voice-call-group-video-stage";
import { isMultiPartyVoiceCall } from "./voice-call-kind-utils";
import type { VoiceCallKind } from "./voice-call-overlay-types";
import { useVoiceCallMedia, useVoiceCallStatus } from "./voice-call-room-context";

function NamePlate({ name, micMuted, className }: { name: string; micMuted?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn(VOICE_CALL_NAME_PLATE, className)}>
      {micMuted ? (
        <>
          <MicOff className="size-3 shrink-0" aria-hidden />
          <span className="sr-only">{t("chat.voice_call_mic_off")}: </span>
        </>
      ) : null}
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The 1-1 stage: the other person large, you in the corner, each named. */
export function VoiceCallVideoStage({
  peerName,
  callKind,
  size = "compact",
}: {
  peerName: string;
  callKind: VoiceCallKind;
  size?: "compact" | "fullscreen";
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

  if (isMultiPartyVoiceCall(callKind)) {
    return (
      <div className={cn("w-full", size === "fullscreen" && "flex min-h-0 flex-1 flex-col")}>
        <VoiceCallGroupVideoStage
          tiles={participantTiles}
          youLabel={t("chat.you")}
          size={size}
          bindParticipantVideo={bindParticipantVideo}
          bindParticipantScreenShare={bindParticipantScreenShare}
        />
      </div>
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
    return (
      <div className="flex flex-col items-center gap-4 py-3 text-center">
        {/* Speaking is live state: the brand ring, the cue the group tiles give. */}
        <Avatar
          className={cn(
            "transition-shadow duration-(--duration-fast)",
            size === "fullscreen" ? "size-36" : "size-30",
            remoteTile?.isSpeaking && "ring-3 ring-brand",
          )}
        >
          <AvatarFallback className="bg-brand-subtle font-display text-display font-bold text-brand-subtle-foreground">
            {voiceCallInitialOf(peerName)}
          </AvatarFallback>
        </Avatar>
        {size === "fullscreen" ? (
          <p className="truncate font-display text-title-lg font-bold text-foreground">{peerName}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl bg-meeting-video-bg",
        size === "fullscreen" && "max-h-[min(70vh,720px)]",
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
      {remoteFillsStage ? <NamePlate name={peerName} micMuted={remoteTile?.micMuted} /> : null}
      {cameraEnabled ? (
        <div
          className={cn(
            "overflow-hidden",
            remoteFillsStage
              ? size === "fullscreen"
                ? "absolute right-4 bottom-4 h-28 w-40 rounded-xl border border-meeting-bar-border shadow-floating sm:h-36 sm:w-52"
                : "absolute right-2 bottom-2 h-16 w-24 rounded-lg border border-meeting-bar-border shadow-floating"
              : "absolute inset-0",
          )}
        >
          <video ref={bindLocalVideo} autoPlay playsInline muted className="size-full scale-x-[-1] object-cover" />
          <NamePlate
            name={t("chat.you")}
            micMuted={muted}
            className={remoteFillsStage && size !== "fullscreen" ? "bottom-1 left-1 px-1.5 text-micro" : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
