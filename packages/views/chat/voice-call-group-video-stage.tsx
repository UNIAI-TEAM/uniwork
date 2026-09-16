"use client";

import { useCallback } from "react";
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
export const voiceCallParticipantStripTileClass =
  "h-[4.75rem] w-[6.75rem] shrink-0 sm:h-24 sm:w-32";

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
        "relative min-h-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border/60",
        layout === "grid" ? "aspect-video" : "size-full",
      )}
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
            <AvatarFallback className="bg-primary/10 text-primary">
              {voiceCallInitialOf(label)}
            </AvatarFallback>
          </Avatar>
        </div>
      )}
      <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground backdrop-blur-sm">
        {label}
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
        "relative min-h-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border/60",
        presentation ? "min-h-0 flex-1" : "aspect-video",
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- LiveKit realtime video has no caption track */}
      <video ref={bindScreenShare} autoPlay playsInline className="size-full object-contain" />
      <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground backdrop-blur-sm">
        {label}
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
  const screenShareTiles = tiles.filter((tile) => tile.hasScreenShare);
  const hasScreenShare = screenShareTiles.length > 0;
  const count = Math.max(tiles.length, 1);
  const gridClass = groupParticipantGridClass(count, size);

  if (tiles.length === 0) {
    return (
      <div
        className={cn(
          "flex w-full items-center justify-center rounded-xl bg-muted ring-1 ring-border/60",
          size === "fullscreen" ? "aspect-video max-h-[min(70vh,720px)]" : "aspect-video max-h-36",
        )}
      >
        <Avatar className="size-16 text-title">
          <AvatarFallback className="bg-primary/10 text-primary">?</AvatarFallback>
        </Avatar>
      </div>
    );
  }

  const participantLabel = (tile: VoiceCallParticipantTile) =>
    tile.isLocal ? youLabel : tile.name.trim() || tile.identity;

  if (hasScreenShare) {
    return (
      <div
        className={cn(
          "flex w-full min-h-0 flex-col gap-2 overflow-hidden rounded-xl bg-background p-2 ring-1 ring-border/60",
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
        "flex w-full flex-col gap-2 overflow-hidden rounded-xl bg-background p-2 ring-1 ring-border/60",
        size === "fullscreen" ? "max-h-[min(70vh,720px)]" : "max-h-64",
      )}
    >
      <div className={cn("grid min-h-0 flex-1 gap-2 auto-rows-fr", gridClass)}>
        {tiles.map((tile) => (
          <VoiceCallParticipantVideoTile
            key={tile.identity}
            tile={tile}
            label={participantLabel(tile)}
            bindParticipantVideo={bindParticipantVideo}
          />
        ))}
      </div>
    </div>
  );
}
