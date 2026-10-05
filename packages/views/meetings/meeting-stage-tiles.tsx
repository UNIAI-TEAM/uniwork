"use client";
import { memo, useRef, useState } from "react";
import {
  isTrackReference,
  useSpeakingParticipants,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingRoomPreferencesStore } from "@uniwork/core/meetings/room-preferences";
import { useMeetingViewSessionStore } from "@uniwork/core/meetings/view-session";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { resolveConferenceStage, speakerSlots, trackTileKey } from "./conference-layout";
import { MeetingParticipantTile } from "./meeting-participant-tile";
import { useRoomAvatarOf } from "./meeting-room-avatars";
import { participantRole } from "./meeting-signals";
import { useSpeakerOrder } from "./use-speaker-order";
import { useStripPlacement } from "./use-strip-placement";

const STAGE_SOURCES = [
  { source: Track.Source.Camera, withPlaceholder: true },
  { source: Track.Source.ScreenShare, withPlaceholder: false },
];
/**
 * Beyond joins, leaves and (un)publishing, which useTracks always follows:
 * only a mute changes what a tile draws. Speaking, connection quality and
 * metadata events are read by each tile for itself, so the stage does not
 * rebuild every tile list on them.
 */
const STAGE_TRACK_EVENTS = [RoomEvent.TrackMuted, RoomEvent.TrackUnmuted];

/** The "+N" tile at the end of a strip; its count is read out as words. */
function OverflowTile({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex aspect-[4/3] shrink-0 items-center justify-center rounded-xl bg-muted text-caption font-medium text-muted-foreground ring-1 ring-surface-border",
        className,
      )}
    >
      <span aria-hidden>{t("meetings.moreParticipantsShort", { count })}</span>
      <span className="sr-only">{t("meetings.moreParticipantsLabel", { count })}</span>
    </div>
  );
}

/** Page switcher for a room with more people than tiles; sits in the tile area, not over the header. */
function StagePager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("meetings.pageOf", { page: page + 1, pages })}
      className="flex shrink-0 items-center justify-center"
    >
      <div className="flex items-center gap-1 rounded-full bg-meeting-bar-bg p-1 text-meeting-bar-foreground ring-1 ring-meeting-bar-border">
        <Button
          type="button"
          size="icon"
          variant="meetingChip"
          className="size-7 rounded-full border-transparent"
          aria-label={t("meetings.prevPage")}
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <span aria-hidden className="px-1 text-caption tabular-nums">
          {page + 1}/{pages}
        </span>
        <Button
          type="button"
          size="icon"
          variant="meetingChip"
          className="size-7 rounded-full border-transparent"
          aria-label={t("meetings.nextPage")}
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

/**
 * The tiles, their strip and pager: the one part of the room that follows
 * track and speaker events. Kept a leaf, so a speaking change repaints this
 * and not the header, side panel or control bar around it.
 */
export const MeetingStageTiles = memo(function MeetingStageTiles({
  canHost,
  guests,
}: {
  canHost: boolean;
  guests: ReadonlySet<string>;
}) {
  const [page, setPage] = useState(0);
  const speaking = useSpeakingParticipants();
  const viewLayout = useMeetingRoomPreferencesStore((s) => s.viewLayout);
  const maxTiles = useMeetingRoomPreferencesStore((s) => s.maxTiles);
  const hideTilesWithoutVideo = useMeetingRoomPreferencesStore((s) => s.hideTilesWithoutVideo);
  const pinnedIdentity = useMeetingViewSessionStore((s) => s.pinnedIdentity);
  const hiddenIdentities = useMeetingViewSessionStore((s) => s.hiddenIdentities);
  const avatarOf = useRoomAvatarOf();
  const tracks = useTracks(STAGE_SOURCES, { onlySubscribed: true, updateOnlyOn: STAGE_TRACK_EVENTS });
  const filters = {
    layout: viewLayout,
    maxTiles,
    pinnedIdentity,
    hiddenIdentities,
    hideWithoutVideo: hideTilesWithoutVideo,
  };
  const slots = speakerSlots(tracks, filters);
  const speakerOrder = useSpeakerOrder(
    slots.cameras,
    slots.slots,
    speaking.map((p) => p.identity),
  );
  const stage = resolveConferenceStage(tracks, { ...filters, page, speakerOrder });
  // A page that no longer exists (people left) clamps to the last one.
  if (stage.page !== page) setPage(stage.page);

  const hasStrip = stage.thumbnails.length > 0 || stage.overflow > 0;
  const presentationRef = useRef<HTMLDivElement>(null);
  const stripSide = useStripPlacement(presentationRef, stage.layoutMode === "sidebar" && hasStrip);
  const stripBeside = stripSide === "beside";
  const tile = (
    track: TrackReferenceOrPlaceholder,
    opts: { compact?: boolean; expanded?: boolean; placement?: "cell" | "stage" },
  ) => {
    const publication = isTrackReference(track) ? track.publication : undefined;
    return (
      <MeetingParticipantTile
        key={trackTileKey(track)}
        participant={track.participant}
        track={track}
        videoTrack={publication?.track}
        videoOn={Boolean(publication?.track) && !publication?.isMuted}
        compact={opts.compact}
        expanded={opts.expanded}
        canHost={canHost}
        roleChip={participantRole(track.participant, guests)}
        avatarUrl={avatarOf(track.participant.identity)}
        placement={opts.placement}
      />
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      {stage.layoutMode === "sidebar" ? (
        // The main tile and its strip are one group, centred together
        // with their tops aligned; the tile sizes itself from this
        // stage minus the strip's room. The strip goes beside or under
        // the tile by the stage's shape (see stripPlacement).
        <div
          ref={presentationRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 items-center justify-center [container-type:size]",
            hasStrip && (stripBeside ? "[--strip-reserve-x:7.75rem]" : "[--strip-reserve-y:5.25rem]"),
          )}
          data-testid="meeting-presentation"
          data-strip={hasStrip ? stripSide : undefined}
        >
          <div
            className={cn(
              "flex max-h-full min-h-0 max-w-full min-w-0 items-start",
              stripBeside ? "flex-row gap-3" : "flex-col gap-2",
            )}
          >
            <div className="shrink-0" data-lk-theme="default">
              {stage.primary.map((track) => tile(track, { expanded: true, placement: "stage" }))}
            </div>
            {hasStrip ? (
              <div
                className={cn(
                  "flex shrink-0",
                  stripBeside
                    ? "max-h-[100cqh] w-28 flex-col gap-2 overflow-y-auto"
                    : "max-w-full gap-2 overflow-x-auto pb-1",
                )}
                data-testid="meeting-side-strip"
              >
                {stage.thumbnails.map((track) => (
                  <div
                    key={trackTileKey(track)}
                    className={cn("aspect-[4/3] shrink-0", stripBeside ? "w-full" : "w-24")}
                  >
                    {tile(track, { compact: true })}
                  </div>
                ))}
                {stage.overflow > 0 ? (
                  <OverflowTile count={stage.overflow} className={stripBeside ? "w-full" : "w-24"} />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div
            className={cn("grid min-h-0 min-w-0 flex-1 auto-rows-fr gap-2 sm:gap-3", stage.gridClass)}
            data-lk-theme="default"
            data-testid="meeting-grid"
          >
            {stage.primary.map((track) =>
              tile(track, {
                expanded: stage.layoutMode === "spotlight" || stage.primary.length === 1,
              }),
            )}
          </div>

          {hasStrip ? (
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1">
              {stage.thumbnails.map((track) => (
                <div key={trackTileKey(track)} className="w-24 shrink-0 sm:w-28">
                  {tile(track, { compact: true })}
                </div>
              ))}
              {stage.overflow > 0 ? <OverflowTile count={stage.overflow} className="w-24 sm:w-28" /> : null}
            </div>
          ) : null}
        </>
      )}
      {stage.pages > 1 ? <StagePager page={stage.page} pages={stage.pages} onPage={setPage} /> : null}
    </div>
  );
});
