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
  const remoteMicMuted = participantTiles.find((tile) => !tile.isLocal)?.micMuted;
  // The big frame shows the peer (or a shared screen). When only our own
  // camera is on, our video takes the whole frame instead of hiding behind
  // the peer's avatar.
  const remoteFillsStage = remoteCameraEnabled || hasScreenShare;

  if (!cameraEnabled && !remoteFillsStage) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <Avatar className={cn("text-title", size === "fullscreen" ? "size-32" : "size-20")}>
          <AvatarFallback className="bg-brand-subtle text-brand-subtle-foreground">
            {voiceCallInitialOf(peerName)}
          </AvatarFallback>
        </Avatar>
        {size === "fullscreen" ? (
          <p className="truncate text-title font-medium text-foreground">{peerName}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl bg-muted ring-1 ring-surface-border",
        size === "fullscreen" ? "aspect-video max-h-[min(70vh,720px)]" : "aspect-video max-h-36",
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- LiveKit realtime video has no caption track */}
      <video
        ref={showRemoteScreenShare ? bindRemoteScreenShare : showLocalScreenShare ? bindLocalScreenShare : bindRemoteVideo}
        autoPlay
        playsInline
        className={cn(
          "size-full",
          hasScreenShare ? "bg-muted object-contain" : "object-cover",
          !remoteFillsStage && "hidden",
        )}
      />
      {remoteFillsStage ? <NamePlate name={peerName} micMuted={remoteMicMuted} /> : null}
      {cameraEnabled ? (
        <div
          className={cn(
            "overflow-hidden",
            remoteFillsStage
              ? size === "fullscreen"
                ? "absolute right-4 bottom-4 h-28 w-40 rounded-xl border border-border shadow-[var(--menu-shadow)] sm:h-36 sm:w-52"
                : "absolute right-2 bottom-2 h-16 w-24 rounded-lg border border-border shadow-[var(--menu-shadow)]"
              : "absolute inset-0",
          )}
        >
          <video ref={bindLocalVideo} autoPlay playsInline muted className="size-full scale-x-[-1] object-cover" />
          <NamePlate name={t("chat.you")} micMuted={muted} />
        </div>
      ) : null}
    </div>
  );
}
