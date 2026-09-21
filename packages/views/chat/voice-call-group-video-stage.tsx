"use client";

import { useCallback } from "react";
import { MicOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { tileGridClass } from "../meetings/conference-layout";
import { voiceCallInitialOf } from "./voice-call-floating-panel";
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

/* The name plate over video: the meeting room's tile tokens (a dark plate
   that reads on any frame), caption size, no blur. */
const NAME_PLATE =
  "absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 truncate rounded-md bg-meeting-tile-name-bg px-1.5 py-0.5 text-caption font-medium text-meeting-tile-name-foreground";

function VoiceCallParticipantVideoTile({
  tile,
  label,
  micOffLabel,
  bindParticipantVideo,
  layout = "grid",
}: {
  tile: VoiceCallParticipantTile;
  label: string;
  micOffLabel: string;
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
        "relative min-h-0 overflow-hidden rounded-lg bg-muted ring-1 transition-shadow duration-(--duration-fast)",
        // Speaking is live state: the brand ring, the same cue the meeting tiles give.
        tile.isSpeaking ? "ring-2 ring-brand" : "ring-surface-border",
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
        <div className="flex size-full items-center justify-center bg-muted">
          <Avatar className={cn("text-body", layout === "strip" ? "size-10 sm:size-12" : "size-12 sm:size-14")}>
            <AvatarFallback className="bg-brand-subtle text-brand-subtle-foreground">
              {voiceCallInitialOf(label)}
            </AvatarFallback>
          </Avatar>
        </div>
      )}
      <span className={NAME_PLATE}>
        {tile.micMuted ? (
          <>
            <MicOff className="size-3 shrink-0" aria-hidden />
            <span className="sr-only">{micOffLabel}: </span>
          </>
        ) : null}
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

function VoiceCallScreenShareTile({
  label,
  bindParticipantScreenShare,
  identity,
  presentation = false,
}: {
  label: string;
  identity: string;
  bindParticipantScreenShare: (identity: string, el: HTMLVideoElement | null) => void;
  presentation?: boolean;
}) {
  const bindScreenShare = useCallback(
    (el: HTMLVideoElement | null) => {
      bindParticipantScreenShare(identity, el);
    },
    [bindParticipantScreenShare, identity],
  );

  return (
    <div
      className={cn(
        "relative min-h-0 overflow-hidden rounded-lg bg-muted ring-1 ring-surface-border",
        presentation ? "min-h-0 flex-1" : "aspect-video",
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- LiveKit realtime video has no caption track */}
      <video ref={bindScreenShare} autoPlay playsInline className="size-full object-contain" />
      <span className={NAME_PLATE}>{label}</span>
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
  const screenShareTiles = tiles.filter((tile) => tile.hasScreenShare);
  const hasScreenShare = screenShareTiles.length > 0;
  const count = Math.max(tiles.length, 1);
  const gridClass = groupParticipantGridClass(count, size);

  if (tiles.length === 0) {
    return (
      <div
        className={cn(
          "flex w-full items-center justify-center rounded-xl bg-muted ring-1 ring-surface-border",
          size === "fullscreen" ? "aspect-video max-h-[min(70vh,720px)]" : "aspect-video max-h-36",
        )}
      >
        <p className="text-caption text-muted-foreground">{t("chat.voice_call_waiting_participants")}</p>
      </div>
    );
  }

  const participantLabel = (tile: VoiceCallParticipantTile) =>
    tile.isLocal ? youLabel : tile.name.trim() || tile.identity;

  if (hasScreenShare) {
    return (
      <div
        className={cn(
          "flex w-full min-h-0 flex-col gap-2 overflow-hidden rounded-xl bg-background p-2 ring-1 ring-surface-border",
          size === "fullscreen" ? "h-full max-h-[min(70vh,720px)] flex-1" : "max-h-64",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {screenShareTiles.map((tile) => (
            <VoiceCallScreenShareTile
              key={`${tile.identity}-screen`}
              identity={tile.identity}
              label={`${participantLabel(tile)} · ${t("meetings.sharedScreen")}`}
              bindParticipantScreenShare={bindParticipantScreenShare}
              presentation
            />
          ))}
        </div>
        <div
          className="flex shrink-0 gap-2 overflow-x-auto pb-0.5 pt-1"
          aria-label={t("chat.voice_call_participant_strip")}
        >
          {tiles.map((tile) => (
            <div key={tile.identity} className={voiceCallParticipantStripTileClass}>
              <VoiceCallParticipantVideoTile
                tile={tile}
                label={participantLabel(tile)}
                micOffLabel={t("chat.voice_call_mic_off")}
                bindParticipantVideo={bindParticipantVideo}
                layout="strip"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 overflow-hidden rounded-xl bg-background p-2 ring-1 ring-surface-border",
        size === "fullscreen" ? "max-h-[min(70vh,720px)]" : "max-h-64",
      )}
    >
      <div className={cn("grid min-h-0 flex-1 gap-2 auto-rows-fr", gridClass)}>
        {tiles.map((tile) => (
          <VoiceCallParticipantVideoTile
            key={tile.identity}
            tile={tile}
            label={participantLabel(tile)}
            micOffLabel={t("chat.voice_call_mic_off")}
            bindParticipantVideo={bindParticipantVideo}
          />
        ))}
      </div>
    </div>
  );
}
