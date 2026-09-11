"use client";
import type { ComponentProps } from "react";
import { useRef, useState } from "react";
import {
  isTrackReference,
  useIsMuted,
  useIsSpeaking,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { Track } from "livekit-client";
import { Eye, EyeOff, Hand, MicOff, MoreVertical, Pin, PinOff, Volume2 } from "lucide-react";
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
import { useMeetingSignals } from "./use-meeting-signals";
import { MeetingPersonAvatar } from "./meeting-person";

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

function hasPlayableVideo(track: TrackReferenceOrPlaceholder | undefined): boolean {
  if (!track || !isTrackReference(track)) return false;
  return Boolean(track.publication.track) && !track.publication.isMuted;
}

function MicStatusBadge({ muted, speaking }: { muted: boolean; speaking: boolean }) {
  if (muted) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
        <MicOff aria-hidden className="size-3.5" />
      </span>
    );
  }
  if (speaking) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
        <Volume2 aria-hidden className="size-3.5" />
      </span>
    );
  }
  return null;
}

function TileActionButton({
  compact,
  className,
  ...props
}: ComponentProps<typeof Button> & { compact?: boolean }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn(
        "rounded-full text-meeting-bar-foreground hover:bg-meeting-bar-chip-hover",
        compact ? "size-7" : "size-8",
        className,
      )}
      {...props}
    />
  );
}

function MeetingTileHoverActions({
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
  const { requestMute } = useMeetingSignals();
  const toggleHidden = useMeetingViewSessionStore((s) => s.toggleHidden);
  const isHidden = useMeetingViewSessionStore((s) => s.isHidden(participant.identity));
  const showHostMute = canHost && !participant.isLocal && !micMuted;

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 flex items-center justify-center transition-opacity motion-reduce:transition-none",
        visible
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-black/35 motion-reduce:transition-none motion-safe:transition-opacity"
      />
      <div
        className={cn(
          "relative flex items-center gap-0.5 rounded-full bg-meeting-bar-bg/95 p-0.5 ring-1 ring-meeting-bar-border backdrop-blur-sm",
          compact && "gap-0",
        )}
      >
        <TileActionButton
          compact={compact}
          aria-label={pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
          aria-pressed={pinned}
          onClick={onPin}
        >
          {pinned ? (
            <PinOff aria-hidden className={compact ? "size-3.5" : "size-4"} />
          ) : (
            <Pin aria-hidden className={compact ? "size-3.5" : "size-4"} />
          )}
        </TileActionButton>

        {showHostMute ? (
          <TileActionButton
            compact={compact}
            aria-label={t("meetings.muteParticipant", { name })}
            onClick={() => requestMute(participant.identity)}
          >
            <MicOff aria-hidden className={compact ? "size-3.5" : "size-4"} />
          </TileActionButton>
        ) : null}

        <DropdownMenu onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger
            render={
              <TileActionButton
                compact={compact}
                aria-label={t("meetings.participantActions", { name })}
                className="data-popup-open:bg-meeting-bar-chip-hover"
              />
            }
          >
            <MoreVertical aria-hidden className={compact ? "size-3.5" : "size-4"} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-44">
            <DropdownMenuItem onClick={onPin}>
              {pinned ? (
                <PinOff aria-hidden className="size-4" />
              ) : (
                <Pin aria-hidden className="size-4" />
              )}
              {pinned ? t("meetings.unpinFromScreen") : t("meetings.pinToScreen")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleHidden(participant.identity)}>
              {isHidden ? (
                <Eye aria-hidden className="size-4" />
              ) : (
                <EyeOff aria-hidden className="size-4" />
              )}
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
    </div>
  );
}

export function MeetingParticipantTile({
  participant,
  track,
  compact = false,
  expanded = false,
  canHost = false,
}: {
  participant: Participant;
  track?: TrackReferenceOrPlaceholder;
  compact?: boolean;
  expanded?: boolean;
  canHost?: boolean;
}) {
  const { t } = useTranslation();
  const mirrorCamera = useMeetingRoomPreferencesStore((s) => s.mirrorCamera);
  const showExpandedLabels = useMeetingRoomPreferencesStore((s) => s.showExpandedLabels);
  const pinnedIdentity = useMeetingViewSessionStore((s) => s.pinnedIdentity);
  const pinParticipant = useMeetingViewSessionStore((s) => s.pinParticipant);
  const pinned = pinnedIdentity === participant.identity;
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const { hands, reactions } = useMeetingSignals();
  const handRaised = hands.includes(participant.identity);
  const reaction = reactions.filter((r) => r.identity === participant.identity).at(-1);
  const name = displayName(participant);
  const label = participant.isLocal ? t("meetings.youSuffix", { name }) : name;
  const isScreenShare =
    track && isTrackReference(track) && track.source === Track.Source.ScreenShare;
  const showVideo = !compact && hasPlayableVideo(track);
  const isLocalCamera =
    participant.isLocal && track && isTrackReference(track) && track.source === Track.Source.Camera;
  const showNameLabel = !expanded || showExpandedLabels;
  const handlePin = () => pinParticipant(pinned ? null : participant.identity);
  const tileRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showHoverActions = hovered || focused || menuOpen;

  return (
    <div
      ref={tileRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") setHovered(true);
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      className={cn(
        "group relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted motion-safe:transition-[width,height,flex-grow] motion-safe:duration-[280ms] motion-safe:ease-out motion-reduce:transition-none",
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
          pinned && "ring-2 ring-inset ring-brand",
          speaking &&
            !pinned &&
            "ring-2 ring-inset ring-success motion-safe:animate-pulse motion-reduce:animate-none",
          handRaised && !pinned && "ring-2 ring-inset ring-warning",
          !pinned && !speaking && !handRaised && "ring-1 ring-inset ring-surface-border",
        )}
      />
      <MeetingTileHoverActions
        participant={participant}
        name={name}
        pinned={pinned}
        compact={compact}
        canHost={canHost}
        micMuted={micMuted}
        visible={showHoverActions}
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
          <span
            aria-label={t("meetings.handRaised")}
            className={cn(
              "flex items-center justify-center rounded-full bg-warning text-background",
              compact ? "size-6" : "size-7",
            )}
          >
            <Hand aria-hidden className={compact ? "size-3.5" : "size-4"} />
          </span>
        ) : null}
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
            isScreenShare ? "object-contain bg-muted" : "object-cover",
            isLocalCamera && mirrorCamera && "scale-x-[-1]",
          )}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <MeetingPersonAvatar
            name={name}
            size={compact ? "sm" : "default"}
            className={cn(compact ? "size-10" : "size-16", "ring-2 ring-brand/30")}
          />
        </div>
      )}
      {showNameLabel ? (
        <span
          className={cn(
            "pointer-events-none absolute z-10 max-w-[calc(100%-2.5rem)] truncate rounded-full px-2.5 py-0.5 text-caption backdrop-blur-sm",
            "bg-meeting-tile-name-bg text-meeting-tile-name-foreground",
            compact ? "bottom-1.5 left-1.5" : "bottom-2 left-2 sm:bottom-3 sm:left-3",
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
