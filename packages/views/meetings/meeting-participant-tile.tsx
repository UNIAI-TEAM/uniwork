"use client";
import {
  isTrackReference,
  useIsMuted,
  useIsSpeaking,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { Track } from "livekit-client";
import { Hand, MicOff, User, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { cn } from "@uniwork/ui/lib/utils";
import { useMeetingSignals } from "./use-meeting-signals";

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

function hasPlayableVideo(track: TrackReferenceOrPlaceholder | undefined): boolean {
  if (!track || !isTrackReference(track)) return false;
  return Boolean(track.publication.track) && !track.publication.isMuted;
}

function MicBadge({ muted, speaking }: { muted: boolean; speaking: boolean }) {
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

export function MeetingParticipantTile({
  participant,
  track,
  compact = false,
  expanded = false,
}: {
  participant: Participant;
  track?: TrackReferenceOrPlaceholder;
  compact?: boolean;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const mirrorCamera = useMeetingRoomPreferencesStore((s) => s.mirrorCamera);
  const showExpandedLabels = useMeetingRoomPreferencesStore((s) => s.showExpandedLabels);
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const { hands, reactions } = useMeetingSignals();
  const handRaised = hands.includes(participant.identity);
  const reaction = reactions.filter((r) => r.identity === participant.identity).at(-1);
  const name = displayName(participant);
  const label = participant.isLocal ? t("meetings.youSuffix", { name }) : name;
  const showVideo = !compact && hasPlayableVideo(track);
  const isLocalCamera =
    participant.isLocal && track && isTrackReference(track) && track.source === Track.Source.Camera;
  const showNameLabel = !expanded || showExpandedLabels;

  return (
    <div
      className={cn(
        "dark relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-rail",
        compact ? "aspect-[4/3] rounded-xl ring-1 ring-border" : "h-full rounded-2xl ring-1 ring-border",
        speaking && "ring-2 ring-success",
        handRaised && "ring-2 ring-warning",
      )}
      data-hand-raised={handRaised || undefined}
    >
      {handRaised ? (
        <span
          aria-label={t("meetings.handRaised")}
          className={cn(
            "absolute z-10 flex items-center justify-center rounded-full bg-warning text-background",
            compact ? "top-2 right-2 size-6" : "top-2 right-2 size-8 sm:top-3 sm:right-3",
          )}
        >
          <Hand aria-hidden className={compact ? "size-3.5" : "size-4"} />
        </span>
      ) : null}
      {reaction ? (
        <span
          key={reaction.id}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/3 z-10 animate-in fade-in zoom-in text-center text-4xl"
        >
          {reaction.value}
        </span>
      ) : null}
      {showVideo && isTrackReference(track) ? (
        <VideoTrack
          trackRef={track}
          className={cn(
            "absolute inset-0 size-full object-cover",
            isLocalCamera && mirrorCamera && "scale-x-[-1]",
          )}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
              compact ? "size-10" : "size-16",
            )}
          >
            <User aria-hidden className={compact ? "size-5" : "size-8"} />
          </span>
        </div>
      )}
      {showNameLabel ? (
        <span
          className={cn(
            "pointer-events-none absolute max-w-[calc(100%-2.5rem)] truncate rounded-full bg-background/80 px-2.5 py-0.5 text-caption text-foreground ring-1 ring-border",
            compact ? "top-2 left-2" : "bottom-2 left-2 sm:bottom-3 sm:left-3",
          )}
        >
          {label}
        </span>
      ) : null}
      <span
        className={cn(
          "pointer-events-none absolute",
          compact ? "right-2 bottom-2" : "right-2 bottom-2 sm:right-3 sm:bottom-3",
        )}
      >
        <MicBadge muted={micMuted} speaking={speaking} />
      </span>
    </div>
  );
}
