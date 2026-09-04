import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { MeetingViewLayout } from "@uniwork/core/meetings/room-preferences";

const TILES_PER_PAGE = 9;
const PRIMARY_GRID_TILES = 6;
const THUMBNAIL_STRIP_TILES = 5;

type StageLayoutMode = "grid" | "spotlight" | "sidebar";

export type ConferenceStage = {
  primary: TrackReferenceOrPlaceholder[];
  thumbnails: TrackReferenceOrPlaceholder[];
  overflow: number;
  pages: number;
  page: number;
  gridClass: string;
  layoutMode: StageLayoutMode;
};

type TrackPublicationLike = {
  track?: unknown;
  isMuted?: boolean;
};

/** CSS grid columns for the conference stage. Keep tiles inside the shell. */
export function tileGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 6) return "grid-cols-2 lg:grid-cols-3";
  return "grid-cols-3";
}

/** Primary video grid: up to six tiles in a 3×2 layout on large screens. */
export function primaryGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  return "grid-cols-2 lg:grid-cols-3";
}

export function splitTracksBySource(tracks: readonly TrackReferenceOrPlaceholder[]): {
  cameras: TrackReferenceOrPlaceholder[];
  screenShares: TrackReferenceOrPlaceholder[];
} {
  const cameras: TrackReferenceOrPlaceholder[] = [];
  const screenShares: TrackReferenceOrPlaceholder[] = [];
  for (const track of tracks) {
    if (track.source === Track.Source.ScreenShare) screenShares.push(track);
    else cameras.push(track);
  }
  return { cameras, screenShares };
}

export function trackHasVideo(track: TrackReferenceOrPlaceholder): boolean {
  if (track.source === Track.Source.ScreenShare) return true;
  const publication = (track as { publication?: TrackPublicationLike }).publication;
  return Boolean(publication?.track) && !publication?.isMuted;
}

export function filterVisibleTracks(
  tracks: readonly TrackReferenceOrPlaceholder[],
  hiddenIdentities: readonly string[],
  hideWithoutVideo: boolean,
): TrackReferenceOrPlaceholder[] {
  const hidden = new Set(hiddenIdentities);
  return tracks.filter((track) => {
    if (hidden.has(track.participant.identity)) return false;
    if (hideWithoutVideo && track.source === Track.Source.Camera && !trackHasVideo(track)) return false;
    return true;
  });
}

export function conferenceStagePage(
  cameras: readonly TrackReferenceOrPlaceholder[],
  page: number,
  primaryTiles = PRIMARY_GRID_TILES,
  thumbnailTiles = THUMBNAIL_STRIP_TILES,
): Omit<ConferenceStage, "gridClass" | "layoutMode"> {
  const pageSize = primaryTiles + thumbnailTiles;
  const { items, pages, page: safePage } = paginate(cameras, page, pageSize);
  const shownThroughPage = safePage * pageSize + items.length;
  return {
    primary: items.slice(0, primaryTiles),
    thumbnails: items.slice(primaryTiles),
    overflow: Math.max(0, cameras.length - shownThroughPage),
    pages,
    page: safePage,
  };
}

export function trackTileKey(track: TrackReferenceOrPlaceholder): string {
  return `${track.participant.identity}:${String(track.source)}`;
}

/**
 * Stage order: screen shares first, then whoever is speaking (most recent
 * first), then everyone else in their existing order. Stable for equal
 * ranks so tiles do not jump around while people talk.
 */
export function orderTracks(
  tracks: readonly TrackReferenceOrPlaceholder[],
  speakingIdentities: readonly string[],
  pinnedIdentity?: string | null,
): TrackReferenceOrPlaceholder[] {
  const rank = (t: TrackReferenceOrPlaceholder): number => {
    if (pinnedIdentity && t.participant.identity === pinnedIdentity) return -1;
    if (t.source === Track.Source.ScreenShare) return 0;
    const i = speakingIdentities.indexOf(t.participant.identity);
    return i === -1 ? 1_000_000 : 1 + i;
  };
  return tracks
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  perPage = TILES_PER_PAGE,
): { items: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safe = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(safe * perPage, safe * perPage + perPage), pages, page: safe };
}

/** Screen share fills the stage; cameras (and extra shares) sit in the side strip. */
function resolvePresentationStage(
  screenShares: readonly TrackReferenceOrPlaceholder[],
  orderedCameras: readonly TrackReferenceOrPlaceholder[],
  page: number,
  thumbnailTiles = THUMBNAIL_STRIP_TILES,
): ConferenceStage {
  const primary = screenShares.slice(0, 1);
  const stripTracks = [...screenShares.slice(1), ...orderedCameras];
  const strip = paginate(stripTracks, page, thumbnailTiles);
  return {
    primary,
    thumbnails: strip.items,
    overflow: Math.max(0, stripTracks.length - (strip.page + 1) * thumbnailTiles),
    pages: strip.pages,
    page: strip.page,
    gridClass: "grid-cols-1",
    layoutMode: "sidebar",
  };
}

export function resolveConferenceStage(
  tracks: readonly TrackReferenceOrPlaceholder[],
  options: {
    layout: MeetingViewLayout;
    maxTiles: number;
    page: number;
    pinnedIdentity?: string | null;
    hiddenIdentities?: readonly string[];
    hideWithoutVideo?: boolean;
    speakingIdentities?: readonly string[];
  },
): ConferenceStage {
  const {
    layout,
    maxTiles,
    page,
    pinnedIdentity = null,
    hiddenIdentities = [],
    hideWithoutVideo = false,
    speakingIdentities = [],
  } = options;

  const visible = filterVisibleTracks(tracks, hiddenIdentities, hideWithoutVideo);
  const { screenShares, cameras } = splitTracksBySource(visible);

  if (screenShares.length > 0) {
    const orderedCameras = orderTracks(cameras, speakingIdentities, pinnedIdentity);
    return resolvePresentationStage(screenShares, orderedCameras, page);
  }

  const ordered = orderTracks(visible, speakingIdentities, pinnedIdentity);

  switch (layout) {
    case "spotlight": {
      const primary = ordered.slice(0, 1);
      const rest = ordered.slice(1);
      const strip = paginate(rest, page, THUMBNAIL_STRIP_TILES);
      return {
        primary,
        thumbnails: strip.items,
        overflow: Math.max(0, rest.length - (strip.page + 1) * THUMBNAIL_STRIP_TILES),
        pages: strip.pages,
        page: strip.page,
        gridClass: "grid-cols-1",
        layoutMode: "spotlight",
      };
    }
    case "sidebar": {
      const primary = ordered.slice(0, 1);
      const rest = ordered.slice(1);
      const strip = paginate(rest, page, maxTiles - 1);
      return {
        primary,
        thumbnails: strip.items,
        overflow: Math.max(0, rest.length - (strip.page + 1) * (maxTiles - 1)),
        pages: strip.pages,
        page: strip.page,
        gridClass: "grid-cols-1",
        layoutMode: "sidebar",
      };
    }
    case "tiled": {
      const paged = paginate(ordered, page, maxTiles);
      return {
        primary: paged.items,
        thumbnails: [],
        overflow: 0,
        pages: paged.pages,
        page: paged.page,
        gridClass: tileGridClass(paged.items.length),
        layoutMode: "grid",
      };
    }
    default: {
      const primaryTiles = Math.min(maxTiles, PRIMARY_GRID_TILES);
      const stage = conferenceStagePage(ordered, page, primaryTiles, THUMBNAIL_STRIP_TILES);
      return {
        ...stage,
        gridClass: primaryGridClass(stage.primary.length),
        layoutMode: "grid",
      };
    }
  }
}
