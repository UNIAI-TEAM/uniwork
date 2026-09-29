"use client";
import type { ComponentProps, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { memo, useEffect, useRef, useState } from "react";
import {
  isTrackReference,
  useConnectionQualityIndicator,
  useIsMuted,
  useIsSpeaking,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { ConnectionQuality, Track } from "livekit-client";
import { Hand, Lock, MicOff, MonitorUp, Volume2, WifiLow, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { cn } from "@uniwork/ui/lib/utils";
import {
  cameraTileSize,
  DEFAULT_CAMERA_ASPECT,
  screenShareTileSize,
  stageFillSize,
  tileControlButtons,
  tileRingTone,
  type TileRingTone,
} from "./conference-layout";
import { MeetingPresentingBar, MeetingPresentingCard } from "./meeting-screen-share-notices";
import { ownSharePreviewable } from "./screen-share";
import { useParticipantSignal } from "./use-meeting-signals";
import { MeetingTileActions } from "./meeting-tile-actions";
import { useMicLocked } from "./meeting-moderation";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRoleChip } from "./meeting-role-chip";
import type { MeetingParticipantRole } from "./meeting-signals";

/** How long a tap keeps a tile's controls up before they step aside again. */
const TOUCH_REVEAL_MS = 4000;

const RING: Record<TileRingTone, string> = {
  hand: "ring-2 ring-inset ring-warning",
  speaking: "ring-2 ring-inset ring-success",
  pinned: "ring-2 ring-inset ring-brand",
  idle: "ring-1 ring-inset ring-surface-border",
};

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

function hasPlayableVideo(track: TrackReferenceOrPlaceholder | undefined): boolean {
  if (!track || !isTrackReference(track)) return false;
  return Boolean(track.publication.track) && !track.publication.isMuted;
}

/**
 * The playing video's width/height, following resolution changes. Until the
 * element reports its own size it takes the publication's advertised size,
 * so a 4:3 or ultrawide share opens in its shape instead of jumping from 16:9.
 */
function useVideoAspect(
  ref: RefObject<HTMLVideoElement | null>,
  active: boolean,
  trackSid: string | null,
  advertised: number | null,
): number {
  const [aspect, setAspect] = useState(advertised ?? DEFAULT_CAMERA_ASPECT);
  useEffect(() => {
    // Only until the element knows better: once it reports its own size, the
    // advertised one (which can lag a rotation) must not override it.
    const video = ref.current;
    if (advertised && !(video && video.videoWidth > 0)) setAspect(advertised);
  }, [ref, advertised, trackSid]);
  useEffect(() => {
    const video = ref.current;
    if (!active || !video) return;
    const read = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setAspect(video.videoWidth / video.videoHeight);
    };
    read();
    video.addEventListener("loadedmetadata", read);
    video.addEventListener("resize", read);
    return () => {
      video.removeEventListener("loadedmetadata", read);
      video.removeEventListener("resize", read);
    };
  }, [ref, active, trackSid]);
  return aspect;
}

function StatusBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      role="img"
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", className)}
      {...props}
    />
  );
}

function MicStatusBadge({ muted, locked, speaking }: { muted: boolean; locked: boolean; speaking: boolean }) {
  const { t } = useTranslation();
  // A lock outranks a mute: it says why the mic stays off, and who can lift it.
  if (locked) {
    return (
      <StatusBadge aria-label={t("meetings.micLocked")} className="bg-warning-solid text-on-solid">
        <Lock aria-hidden className="size-3.5" />
      </StatusBadge>
    );
  }
  if (muted) {
    return (
      <StatusBadge aria-label={t("meetings.micIsOff")} className="bg-destructive-solid text-on-solid">
        <MicOff aria-hidden className="size-3.5" />
      </StatusBadge>
    );
  }
  if (speaking) {
    return (
      <StatusBadge aria-label={t("meetings.speaking")} className="bg-success-solid text-on-solid">
        <Volume2 aria-hidden className="size-3.5" />
      </StatusBadge>
    );
  }
  return null;
}

/** Only a weak or lost link earns a badge; a healthy one is the default and says nothing. */
function ConnectionQualityBadge({ participant }: { participant: Participant }) {
  const { t } = useTranslation();
  const { quality } = useConnectionQualityIndicator({ participant });
  if (quality === ConnectionQuality.Poor) {
    return (
      <StatusBadge aria-label={t("meetings.connectionPoor")} className="bg-warning-solid text-on-solid">
        <WifiLow aria-hidden className="size-3.5" />
      </StatusBadge>
    );
  }
  if (quality === ConnectionQuality.Lost) {
    return (
      <StatusBadge aria-label={t("meetings.connectionQualityLost")} className="bg-destructive-solid text-on-solid">
        <WifiOff aria-hidden className="size-3.5" />
      </StatusBadge>
    );
  }
  return null;
}

/**
 * Touch has no hover: a tap on the tile toggles its controls, and they step
 * aside again after a few seconds or on a tap anywhere else. A tap on a
 * control itself is left to that control.
 */
function useTouchReveal(tileRef: RefObject<HTMLDivElement | null>, hold: boolean) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed || hold) return;
    const timer = window.setTimeout(() => setRevealed(false), TOUCH_REVEAL_MS);
    const onPointerDown = (event: PointerEvent) => {
      if (!tileRef.current?.contains(event.target as Node)) setRevealed(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [revealed, hold, tileRef]);

  const onTilePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if ((event.target as Element).closest("[data-tile-controls]")) return;
    setRevealed((v) => !v);
  };

  return { revealed, onTilePointerDown };
}

type MeetingParticipantTileProps = {
  participant: Participant;
  track?: TrackReferenceOrPlaceholder;
  compact?: boolean;
  expanded?: boolean;
  canHost?: boolean;
  roleChip?: MeetingParticipantRole | null;
  /** The person's photo, shown while their camera is off. */
  avatarUrl?: string;
  /**
   * `cell`: the tile centres in its own grid cell. `stage`: it is the main
   * tile of a presentation group and sizes itself from the stage, leaving the
   * strip's room (see STRIP_RESERVE_X in conference-layout).
   */
  placement?: "cell" | "stage";
  /**
   * The media track and whether it plays, read by the parent at its render.
   * The publication object is mutated in place, so the memo compares these
   * snapshots rather than the publication.
   */
  videoTrack?: unknown;
  videoOn?: boolean;
};

function MeetingParticipantTileImpl({
  participant,
  track,
  compact = false,
  expanded = false,
  canHost = false,
  roleChip = null,
  avatarUrl,
  placement = "cell",
  videoOn,
}: MeetingParticipantTileProps) {
  const { t } = useTranslation();
  const mirrorCamera = useMeetingRoomPreferencesStore((s) => s.mirrorCamera);
  const showExpandedLabels = useMeetingRoomPreferencesStore((s) => s.showExpandedLabels);
  const pinnedIdentity = useMeetingViewSessionStore((s) => s.pinnedIdentity);
  const pinParticipant = useMeetingViewSessionStore((s) => s.pinParticipant);
  const pinned = pinnedIdentity === participant.identity;
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const micLocked = useMicLocked(participant);
  const { handRaised, reaction } = useParticipantSignal(participant.identity);
  const name = displayName(participant);
  const isScreenShare = Boolean(
    track && isTrackReference(track) && track.source === Track.Source.ScreenShare,
  );
  // A share says whose screen it is, so it never reads as a second camera
  // tile of the same person; a thumbnail has room for "You" but not the name.
  const label = isScreenShare
    ? t("meetings.presentingName", { name })
    : participant.isLocal
      ? compact
        ? t("meetings.you")
        : t("meetings.youSuffix", { name })
      : name;
  // Thumbnails play video too: adaptive stream subscribes them at the small
  // simulcast layer, so the avatar only stands in when the camera is off.
  const showVideo = videoOn ?? hasPlayableVideo(track);
  const isLocalCamera =
    participant.isLocal && track && isTrackReference(track) && track.source === Track.Source.Camera;
  const showNameLabel = !expanded || showExpandedLabels;
  const handlePin = () => pinParticipant(pinned ? null : participant.identity);
  const tileRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const touch = useTouchReveal(tileRef, menuOpen);
  const showActions = hovered || focused || menuOpen || touch.revealed;
  // Room the corner controls take: one button width each (2rem, or 2.75rem
  // on a coarse pointer, where buttons grow to 44px) plus their padding and
  // both insets. Exact, so a phone's tile keeps "quang (Bạn)" beside pin and
  // menu, where a flat 8rem cut every name to one letter. The host's mute
  // keeps its slot once the mic is off (see MeetingTileActions).
  const hostMuteButton = canHost && !participant.isLocal;
  // The quick mute is one slot on a fine pointer and none on a coarse one
  // (the menu keeps it): three 44px buttons left a phone's tile no name.
  const otherButtons =
    tileControlButtons({ screenShare: isScreenShare, hostMute: hostMuteButton }) - (hostMuteButton ? 1 : 0);
  const buttonCount = hostMuteButton ? `(${otherButtons} + var(--tile-mute-slot))` : `${otherButtons}`;
  // Speaking and a raised hand belong to the person's camera tile; lit on the
  // share as well, the presenter's voice flashed two tiles at once.
  const ring = isScreenShare
    ? tileRingTone({ handRaised: false, speaking: false, pinned: false })
    : tileRingTone({ handRaised, speaking, pinned });
  // Your own share of a tab or window is drawn back to you; a whole screen
  // stays a card, or it would show the meeting inside itself.
  const ownShare = Boolean(isScreenShare && participant.isLocal);
  const previewable =
    ownShare && track !== undefined && isTrackReference(track) && ownSharePreviewable(track.publication.track?.mediaStreamTrack);
  // The presenter may put the preview away (a busy screen, a slow machine);
  // the choice follows the share across stage, grid and strip.
  const shareSid = ownShare && track && isTrackReference(track) ? track.publication.trackSid : "";
  const previewHidden = useMeetingViewSessionStore((s) => s.hiddenSharePreviews.includes(shareSid));
  const setSharePreviewHidden = useMeetingViewSessionStore((s) => s.setSharePreviewHidden);
  const setPreviewHidden = (hidden: boolean) => setSharePreviewHidden(shareSid, hidden);
  const ownPreview = previewable && !previewHidden;
  const presenting = ownShare && !ownPreview;
  // A shared screen keeps its corners: a big radius clipped the logo, menus
  // or close button that usually sit there.
  const radius = compact ? "rounded-2xl" : isScreenShare ? "rounded-xl" : "rounded-3xl";
  // A tile takes its video's shape and centres in its cell: a camera may crop
  // its sides a little (see cameraTileSize), a screen share never crops, so
  // the frame hugs the shared screen whatever shape the cell takes.
  const fitVideo = !compact && !presenting;
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoSid = track && isTrackReference(track) ? track.publication.trackSid : null;
  const dimensions = track && isTrackReference(track) ? track.publication.dimensions : undefined;
  const advertisedAspect =
    dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : null;
  const videoAspect = useVideoAspect(videoRef, fitVideo && showVideo, videoSid, advertisedAspect);
  // A tile with no picture has no shape to keep: it fills its cell, so a
  // phone's grid of camera-off tiles is not three short bands in tall cells.
  const shaped = fitVideo && (showVideo || isScreenShare);
  const tileStyle = shaped
    ? (isScreenShare ? screenShareTileSize : cameraTileSize)(videoAspect, placement === "stage")
    : placement === "stage"
      ? stageFillSize()
      : undefined;

  const tile = (
    <div
      ref={tileRef}
      // Pointer (not mouse) events: a tap fires compatibility mouseenter with
      // no mouseleave, which used to leave the controls stuck over the face.
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHovered(false);
      }}
      onPointerDown={touch.onTilePointerDown}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted",
        // One corner button's width, for the name chip's room beside them.
        "[--tile-control:2rem] [--tile-mute-slot:1] pointer-coarse:[--tile-control:2.75rem] pointer-coarse:[--tile-mute-slot:0]",
        radius,
        compact ? "aspect-[4/3]" : placement === "cell" && (shaped ? "h-full" : "size-full"),
      )}
      style={tileStyle}
      data-hand-raised={handRaised || undefined}
      data-pinned={pinned || undefined}
      data-speaking={speaking || undefined}
    >
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 z-20", radius, RING[ring])}
      />
      <MeetingTileActions
        participant={participant}
        name={name}
        pinned={pinned}
        compact={compact}
        canHost={canHost}
        micMuted={micMuted}
        screenShare={isScreenShare}
        visible={showActions}
        onMenuOpenChange={setMenuOpen}
        onPin={handlePin}
      />
      <div
        className={cn(
          "absolute z-10 flex items-center gap-1",
          compact ? "top-1.5 right-1.5" : "top-2 right-2 sm:top-3 sm:right-3",
        )}
      >
        {handRaised ? (
          <StatusBadge
            aria-label={t("meetings.handRaised")}
            className={cn("bg-warning-solid text-on-solid", !compact && "size-7")}
          >
            <Hand aria-hidden className={compact ? "size-3.5" : "size-4"} />
          </StatusBadge>
        ) : null}
        <ConnectionQualityBadge participant={participant} />
        <MicStatusBadge muted={micMuted} locked={micLocked} speaking={speaking} />
      </div>
      {reaction ? (
        <span
          key={reaction.id}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/3 z-10 animate-reaction-pop text-center text-display"
        >
          {reaction.value}
        </span>
      ) : null}
      {presenting ? (
        <MeetingPresentingCard
          compact={compact}
          onShowPreview={previewable ? () => setPreviewHidden(false) : undefined}
        />
      ) : showVideo && isTrackReference(track) ? (
        <VideoTrack
          ref={videoRef}
          trackRef={track}
          className={cn(
            "absolute inset-0 size-full",
            isScreenShare ? "bg-meeting-video-bg object-contain" : "object-cover",
            isLocalCamera && mirrorCamera && "scale-x-[-1]",
          )}
        />
      ) : compact ? (
        // The name chip owns the bottom band, so the face centres above it.
        <div className="flex min-h-0 flex-1 items-center justify-center pb-5">
          <MeetingPersonAvatar
            name={name}
            avatarUrl={avatarUrl}
            size="lg"
            tone="stage"
            className="ring-2 ring-meeting-bar-border"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <MeetingPersonAvatar
            name={name}
            avatarUrl={avatarUrl}
            size="stage"
            // Grows with the tile (its cell is the size container) within bounds.
            className="size-[clamp(3.5rem,24cqmin,9rem)] ring-2 ring-meeting-bar-border"
          />
        </div>
      )}
      {/* The presenter's own preview carries the bar in place of the name chip:
          "X is presenting" about yourself says the same thing twice. */}
      {ownPreview ? <MeetingPresentingBar compact={compact} onHidePreview={() => setPreviewHidden(true)} /> : null}
      {presenting || ownPreview ? null : showNameLabel ? (
        <span
          className={cn(
            "pointer-events-none absolute z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption",
            "bg-meeting-tile-name-bg text-meeting-tile-name-foreground",
            // Leave the bottom-right corner to the tile controls.
            compact
              ? "bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)]"
              : "bottom-2 left-2 sm:bottom-3 sm:left-3",
            // The corner controls only need room while they show (see
            // buttonCount); kept always, a phone's tile cut every name short.
            !compact && !showActions && "max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-1.5rem)]",
            // A thumbnail is too narrow for the name and the controls at once.
            // A thumbnail keeps the name beside its one control, cut short.
            compact && showActions && "max-w-[calc(100%-var(--tile-control)-1rem)]",
          )}
          style={
            !compact && showActions
              ? { maxWidth: `calc(100% - (${buttonCount} * var(--tile-control) + 1.5rem))` }
              : undefined
          }
        >
          {isScreenShare ? <MonitorUp aria-hidden className="size-3.5 shrink-0" /> : null}
          <span className="min-w-0 truncate">{label}</span>
          {roleChip && !isScreenShare ? <MeetingRoleChip role={roleChip} /> : null}
        </span>
      ) : (
        // The label is hidden for a clean full view; the name still reaches assistive tech.
        <span className="sr-only">{label}</span>
      )}
    </div>
  );

  if (!fitVideo || placement === "stage") return tile;
  return (
    <div className="flex size-full min-h-0 min-w-0 items-center justify-center [container-type:size]">{tile}</div>
  );
}

/**
 * useTracks hands out fresh track objects on every room event; compare what a
 * tile draws, so a speaker change repaints the tiles it touches, not all.
 */
export const MeetingParticipantTile = memo(
  MeetingParticipantTileImpl,
  (a, b) =>
    a.participant === b.participant &&
    a.track?.source === b.track?.source &&
    a.videoTrack === b.videoTrack &&
    a.videoOn === b.videoOn &&
    a.compact === b.compact &&
    a.expanded === b.expanded &&
    a.canHost === b.canHost &&
    a.roleChip === b.roleChip &&
    a.avatarUrl === b.avatarUrl &&
    a.placement === b.placement,
);
