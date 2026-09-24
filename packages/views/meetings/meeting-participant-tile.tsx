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
import { Eye, EyeOff, Hand, MicOff, MoreVertical, Pin, PinOff, Volume2, WifiLow, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { tileRingTone, type TileRingTone } from "./conference-layout";
import { useParticipantSignal, useRequestMute } from "./use-meeting-signals";
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

function StatusBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      role="img"
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", className)}
      {...props}
    />
  );
}

function MicStatusBadge({ muted, speaking }: { muted: boolean; speaking: boolean }) {
  const { t } = useTranslation();
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

function TileActionButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn(
        "size-8 rounded-full text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover hover:text-meeting-bar-foreground",
        className,
      )}
      {...props}
    />
  );
}

function MeetingTileActions({
  participant,
  name,
  pinned,
  compact,
  canHost,
  micMuted,
  visible,
  onMenuOpenChange,
  onPin,
}: {
  participant: Participant;
  name: string;
  pinned: boolean;
  compact: boolean;
  canHost: boolean;
  micMuted: boolean;
  visible: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onPin: () => void;
}) {
  const { t } = useTranslation();
  const requestMute = useRequestMute();
  const toggleHidden = useMeetingViewSessionStore((s) => s.toggleHidden);
  const isHidden = useMeetingViewSessionStore((s) => s.isHidden(participant.identity));
  const showHostMute = canHost && !participant.isLocal && !micMuted;

  // The controls sit in a corner on their own chip, so the face stays visible
  // and the dark wash is only behind the buttons. A thumbnail is too narrow
  // for three touch targets: it keeps the menu, which holds every action.
  return (
    <div
      data-tile-controls
      className={cn(
        "absolute z-30 flex items-center gap-0.5 rounded-full bg-meeting-bar-bg p-0.5 ring-1 ring-meeting-bar-border transition-opacity duration-fast motion-reduce:transition-none",
        compact ? "right-1 bottom-1" : "right-2 bottom-2 sm:right-3 sm:bottom-3",
        visible
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
      )}
    >
      {!compact ? (
        <TileActionButton
          aria-label={pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
          aria-pressed={pinned}
          onClick={onPin}
        >
          {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
        </TileActionButton>
      ) : null}

      {!compact && showHostMute ? (
        <TileActionButton
          aria-label={t("meetings.muteParticipant", { name })}
          onClick={() => requestMute(participant.identity)}
        >
          <MicOff aria-hidden className="size-4" />
        </TileActionButton>
      ) : null}

      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          render={
            <TileActionButton
              aria-label={t("meetings.participantActions", { name })}
              className={cn("data-popup-open:bg-meeting-bar-chip-hover", compact && "size-7")}
            />
          }
        >
          <MoreVertical aria-hidden className={compact ? "size-3.5" : "size-4"} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={onPin}>
            {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
            {pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggleHidden(participant.identity)}>
            {isHidden ? <Eye aria-hidden className="size-4" /> : <EyeOff aria-hidden className="size-4" />}
            {isHidden ? t("meetings.watchParticipant") : t("meetings.dontWatch")}
          </DropdownMenuItem>
          {showHostMute ? (
            <DropdownMenuItem onClick={() => requestMute(participant.identity)}>
              <MicOff aria-hidden className="size-4" />
              {t("meetings.muteParticipant", { name })}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
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
  const { handRaised, reaction } = useParticipantSignal(participant.identity);
  const name = displayName(participant);
  const label = participant.isLocal ? t("meetings.youSuffix", { name }) : name;
  const isScreenShare =
    track && isTrackReference(track) && track.source === Track.Source.ScreenShare;
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
  const ring = tileRingTone({ handRaised, speaking, pinned });

  return (
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
        compact ? "aspect-[4/3] rounded-2xl" : "h-full rounded-3xl",
      )}
      data-hand-raised={handRaised || undefined}
      data-pinned={pinned || undefined}
      data-speaking={speaking || undefined}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-20",
          compact ? "rounded-2xl" : "rounded-3xl",
          RING[ring],
        )}
      />
      <MeetingTileActions
        participant={participant}
        name={name}
        pinned={pinned}
        compact={compact}
        canHost={canHost}
        micMuted={micMuted}
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
        <MicStatusBadge muted={micMuted} speaking={speaking} />
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
      {showVideo && isTrackReference(track) ? (
        <VideoTrack
          trackRef={track}
          className={cn(
            "absolute inset-0 size-full",
            isScreenShare ? "bg-meeting-video-bg object-contain" : "object-cover",
            isLocalCamera && mirrorCamera && "scale-x-[-1]",
          )}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <MeetingPersonAvatar
            name={name}
            size={compact ? "lg" : "xl"}
            className="ring-2 ring-meeting-bar-border"
          />
        </div>
      )}
      {showNameLabel ? (
        <span
          className={cn(
            "pointer-events-none absolute z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption",
            "bg-meeting-tile-name-bg text-meeting-tile-name-foreground",
            // Leave the bottom-right corner to the tile controls.
            compact
              ? "bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)]"
              : "bottom-2 left-2 max-w-[calc(100%-8rem)] sm:bottom-3 sm:left-3",
            // A thumbnail is too narrow for the name and the controls at once.
            compact && showActions && "opacity-0",
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          {roleChip ? <MeetingRoleChip role={roleChip} /> : null}
        </span>
      ) : (
        // The label is hidden for a clean full view; the name still reaches assistive tech.
        <span className="sr-only">{label}</span>
      )}
    </div>
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
    a.roleChip === b.roleChip,
);
