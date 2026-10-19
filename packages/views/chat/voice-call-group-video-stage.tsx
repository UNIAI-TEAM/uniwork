"use client";

import { useCallback } from "react";
import { MicOff, MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { tileGridClass } from "../meetings/conference-layout";
import { initialsOf } from "./chat-initials";
import { chatPersonFaceClass } from "./chat-person-card";
import type { VoiceCallParticipantTile } from "./voice-call-room";

/** Equal participant tiles when cameras are on (no screen share). */
export function groupParticipantGridClass(
  count: number,
  size: "compact" | "fullscreen",
): string {
  if (size === "fullscreen") return tileGridClass(count);
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  if (count === 4) return "grid-cols-2";
  return "grid-cols-3";
}

/** Fixed-size filmstrip tile while someone is presenting their screen. */
export const voiceCallParticipantStripTileClass = "aspect-video w-28 shrink-0 sm:w-32";
/** The fullscreen filmstrip's 164×92 tile. */
const FULLSCREEN_STRIP_TILE = "aspect-video w-41 shrink-0";

/** The fullscreen stage: the dark frame the shared screen, the grid or the face sit in. */
export const VOICE_CALL_STAGE =
  "relative min-h-0 flex-1 overflow-hidden rounded-xl bg-call-stage ring-1 ring-call-hairline ring-inset";

/* The name plate over video: a dark plate that reads on any frame, caption
   size, no blur. */
const VOICE_CALL_NAME_PLATE =
  "absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] items-center gap-1 truncate rounded-md bg-meeting-tile-name-bg px-1.75 py-0.5 text-caption font-medium text-meeting-tile-name-foreground";

/** A person's name over their frame, with the muted mark read out before it. */
export function VoiceCallNamePlate({
  name,
  micMuted,
  className,
}: {
  name: string;
  micMuted?: boolean;
  className?: string;
}) {
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

function VoiceCallParticipantVideoTile({
  tile,
  label,
  bindParticipantVideo,
  layout = "grid",
}: {
  tile: VoiceCallParticipantTile;
  label: string;
  bindParticipantVideo: (identity: string, el: HTMLVideoElement | null) => void;
  layout?: "grid" | "strip";
}) {
  const bindVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      bindParticipantVideo(tile.identity, el);
    },
    [bindParticipantVideo, tile.identity],
  );

  return (
    <div
      className={cn(
        "relative min-h-0 overflow-hidden rounded-lg bg-call-tile transition-shadow duration-(--duration-fast)",
        // Speaking is live state: the speaking ring, the same cue the meeting tiles give.
        tile.isSpeaking && "ring-2 ring-call-speaking",
        layout === "grid" ? "aspect-video" : "size-full",
      )}
      data-speaking={tile.isSpeaking ? "true" : undefined}
    >
      {tile.hasVideo ? (
        /* eslint-disable-next-line jsx-a11y/media-has-caption -- LiveKit realtime video has no caption track */
        <video
          ref={bindVideo}
          autoPlay
          playsInline
          muted={tile.isLocal}
          className={cn("size-full object-cover", tile.isLocal && "scale-x-[-1]")}
        />
      ) : (
        <div className="flex size-full items-center justify-center pb-3.5">
          <span
            aria-hidden
            className={cn(
              "inline-flex items-center justify-center rounded-full",
              layout === "strip" ? "size-11 text-body" : "size-11.5 text-body-lg",
              chatPersonFaceClass(tile.identity),
            )}
          >
            {initialsOf(tile.name || label)}
          </span>
        </div>
      )}
      <VoiceCallNamePlate name={label} micMuted={tile.micMuted} />
    </div>
  );
}

function VoiceCallScreenShareTile({
  label,
  bindParticipantScreenShare,
  identity,
  size,
}: {
  label: string;
  identity: string;
  bindParticipantScreenShare: (identity: string, el: HTMLVideoElement | null) => void;
  size: "compact" | "fullscreen";
}) {
  const bindScreenShare = useCallback(
    (el: HTMLVideoElement | null) => {
      bindParticipantScreenShare(identity, el);
    },
    [bindParticipantScreenShare, identity],
  );

  return (
    <div className={size === "fullscreen" ? VOICE_CALL_STAGE : "relative min-h-0 flex-1 overflow-hidden rounded-lg bg-call-stage"}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- LiveKit realtime video has no caption track */}
      <video ref={bindScreenShare} autoPlay playsInline className="size-full object-contain" />
      <span
        className={cn(
          VOICE_CALL_NAME_PLATE,
          size === "fullscreen" && "bottom-3 left-3 gap-1.5 rounded-lg px-2.5 py-1.25 text-label",
        )}
      >
        <MonitorUp aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

/** Equal grid for group voice/video calls (Zalo / FaceTime style). */
export function VoiceCallGroupVideoStage({
  tiles,
  youLabel,
  size,
  bindParticipantVideo,
  bindParticipantScreenShare,
}: {
  tiles: VoiceCallParticipantTile[];
  youLabel: string;
  size: "compact" | "fullscreen";
  bindParticipantVideo: (identity: string, el: HTMLVideoElement | null) => void;
  bindParticipantScreenShare: (identity: string, el: HTMLVideoElement | null) => void;
}) {
  const { t } = useTranslation();
  const fullscreen = size === "fullscreen";
  const screenShareTiles = tiles.filter((tile) => tile.hasScreenShare);
  const hasScreenShare = screenShareTiles.length > 0;
  const count = Math.max(tiles.length, 1);
  const gridClass = groupParticipantGridClass(count, size);

  if (tiles.length === 0) {
    return (
      <div
        className={cn(
          "flex w-full items-center justify-center",
          fullscreen ? VOICE_CALL_STAGE : "aspect-video max-h-36 rounded-lg bg-call-tile",
        )}
      >
        <p className="text-caption text-call-muted-foreground">{t("chat.voice_call_waiting_participants")}</p>
      </div>
    );
  }

  const participantLabel = (tile: VoiceCallParticipantTile) =>
    tile.isLocal ? youLabel : tile.name.trim() || tile.identity;

  if (hasScreenShare) {
    return (
      <div className={cn("flex w-full min-h-0 flex-col overflow-hidden", fullscreen ? "flex-1 gap-3" : "max-h-64 gap-2")}>
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {screenShareTiles.map((tile) => (
            <VoiceCallScreenShareTile
              key={`${tile.identity}-screen`}
              identity={tile.identity}
              label={`${participantLabel(tile)} · ${t("meetings.sharedScreen")}`}
              bindParticipantScreenShare={bindParticipantScreenShare}
              size={size}
            />
          ))}
        </div>
        <div
          role="list"
          className={cn("flex shrink-0 gap-2 overflow-x-auto p-0.5", fullscreen ? "justify-center gap-2.5" : "pt-1")}
          aria-label={t("chat.voice_call_participant_strip")}
        >
          {tiles.map((tile) => (
            <div
              key={tile.identity}
              role="listitem"
              className={fullscreen ? FULLSCREEN_STRIP_TILE : voiceCallParticipantStripTileClass}
            >
              <VoiceCallParticipantVideoTile
                tile={tile}
                label={participantLabel(tile)}
                bindParticipantVideo={bindParticipantVideo}
                layout="strip"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // More people than the frame holds: the grid scrolls instead of cutting
  // tiles off, so nobody in the call silently disappears from view.
  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden",
        fullscreen ? cn(VOICE_CALL_STAGE, "justify-center p-4") : "max-h-64",
      )}
    >
      <div
        role="list"
        aria-label={t("chat.voice_call_participant_grid")}
        className={cn("grid min-h-0 gap-2 overflow-y-auto p-0.5", gridClass, fullscreen && "mx-auto w-full max-w-5xl")}
      >
        {tiles.map((tile) => (
          <div key={tile.identity} role="listitem" className="min-w-0">
            <VoiceCallParticipantVideoTile
              tile={tile}
              label={participantLabel(tile)}
              bindParticipantVideo={bindParticipantVideo}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
