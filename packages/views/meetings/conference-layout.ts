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
  trackSid?: string;
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

/**
 * The tiles the viewer chose to see. Hiding a person hides their camera only:
 * a screen share is the room's content, and hiding it would leave the viewer
 * the one person in the room not watching the presentation.
 */
export function filterVisibleTracks(
  tracks: readonly TrackReferenceOrPlaceholder[],
  hiddenIdentities: readonly string[],
  hideWithoutVideo: boolean,
): TrackReferenceOrPlaceholder[] {
  const hidden = new Set(hiddenIdentities);
  return tracks.filter((track) => {
    if (track.source !== Track.Source.ScreenShare && hidden.has(track.participant.identity)) return false;
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

/** A share's publication sid: a new share is a new sid, even from the same person. */
export function shareTrackSid(track: TrackReferenceOrPlaceholder): string {
  return (track as { publication?: TrackPublicationLike }).publication?.trackSid ?? trackTileKey(track);
}

/**
 * Share sids, newest first by when this client first saw each. A tie (both
 * already on when this client joined) goes to the greater identity, the one
 * presenterVerdict keeps on, so every client puts the same share on the stage.
 */
export function newestSharesFirst(
  shares: readonly { sid: string; identity: string; seenAt: number }[],
): string[] {
  return [...shares]
    .sort((a, b) => b.seenAt - a.seenAt || (a.identity < b.identity ? 1 : a.identity > b.identity ? -1 : 0))
    .map((s) => s.sid);
}

/** Shares in `shareOrder` (sids, newest first); any it does not name follow in the room's order. */
function orderShares(
  screenShares: readonly TrackReferenceOrPlaceholder[],
  shareOrder: readonly string[],
): TrackReferenceOrPlaceholder[] {
  const slot = new Map(shareOrder.map((sid, i) => [sid, i]));
  return screenShares
    .map((t, i) => ({ t, i, r: slot.get(shareTrackSid(t)) ?? Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/**
 * Stage order: the pinned tile, then screen shares, then cameras in
 * `speakerOrder` (see promoteSpeakers), anyone it does not name after them in
 * the room's own order.
 */
export function orderTracks(
  tracks: readonly TrackReferenceOrPlaceholder[],
  speakerOrder: readonly string[],
  pinnedIdentity?: string | null,
): TrackReferenceOrPlaceholder[] {
  const slot = new Map(speakerOrder.map((identity, i) => [identity, i]));
  const rank = (t: TrackReferenceOrPlaceholder): number => {
    if (pinnedIdentity && t.participant.identity === pinnedIdentity) return -1;
    if (t.source === Track.Source.ScreenShare) return 0;
    return 1 + (slot.get(t.participant.identity) ?? 1_000_000);
  };
  return tracks
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/** How long a promoted speaker keeps their tile after they last spoke. */
export const SPEAKER_HOLD_MS = 2500;

/**
 * The camera tiles that take part in speaker promotion, in the room's order
 * (the pinned one keeps its own place), and how many of them the viewer sees
 * in the main area: past those slots, a speaker is promoted into them.
 */
export function speakerSlots(
  tracks: readonly TrackReferenceOrPlaceholder[],
  options: {
    layout: MeetingViewLayout;
    maxTiles: number;
    pinnedIdentity?: string | null;
    hiddenIdentities?: readonly string[];
    hideWithoutVideo?: boolean;
  },
): { cameras: string[]; slots: number } {
  const { layout, maxTiles, pinnedIdentity = null, hiddenIdentities = [], hideWithoutVideo = false } = options;
  const { screenShares, cameras } = splitTracksBySource(
    filterVisibleTracks(tracks, hiddenIdentities, hideWithoutVideo),
  );
  // The first strip page is what the viewer sees next to a share.
  const mainSlots =
    screenShares.length > 0
      ? Math.max(0, THUMBNAIL_STRIP_TILES - (screenShares.length - 1))
      : layout === "spotlight" || layout === "sidebar"
        ? 1
        : layout === "tiled"
          ? maxTiles
          : Math.min(maxTiles, PRIMARY_GRID_TILES);
  const identities = [...new Set(cameras.map((t) => t.participant.identity))];
  const pinned = pinnedIdentity !== null && identities.includes(pinnedIdentity);
  return {
    cameras: pinned ? identities.filter((id) => id !== pinnedIdentity) : identities,
    slots: Math.max(0, mainSlots - (pinned ? 1 : 0)),
  };
}

/**
 * The next speaker order. A speaker past the first `slots` swaps places with
 * the quietest tile inside them, so one tile moves in and one out while every
 * other tile stays where it was. A tile whose person spoke within `holdMs`
 * (or still speaks) is never the one to give way: the speaker waits, and
 * `retryAt` says when the first held tile frees up. People who left drop out;
 * newcomers join the end in the room's order.
 */
export function promoteSpeakers(
  order: readonly string[],
  input: {
    cameras: readonly string[];
    slots: number;
    speaking: readonly string[];
    lastSpokeAt: ReadonlyMap<string, number>;
    now: number;
    holdMs?: number;
  },
): { order: string[]; retryAt?: number } {
  const { cameras, slots, speaking, lastSpokeAt, now, holdMs = SPEAKER_HOLD_MS } = input;
  const present = new Set(cameras);
  const next = order.filter((id) => present.has(id));
  const placed = new Set(next);
  for (const id of cameras) if (!placed.has(id)) next.push(id);
  const talking = new Set(speaking);
  const shown = Math.min(slots, next.length);
  let retryAt: number | undefined;
  for (const id of speaking) {
    const from = next.indexOf(id);
    if (from < shown) continue;
    let victim = -1;
    let victimSpoke = Infinity;
    for (let j = 0; j < shown; j++) {
      const occupant = next[j]!;
      if (talking.has(occupant)) continue;
      const spoke = lastSpokeAt.get(occupant) ?? -Infinity;
      if (now - spoke < holdMs) {
        retryAt = Math.min(retryAt ?? Infinity, spoke + holdMs);
        continue;
      }
      // The quietest gives way; on a tie the later slot, so the top-left stays put.
      if (spoke <= victimSpoke) {
        victim = j;
        victimSpoke = spoke;
      }
    }
    if (victim === -1) continue;
    next[from] = next[victim]!;
    next[victim] = id;
  }
  // A wait only matters while someone still waits for a slot.
  const waiting = speaking.some((id) => next.indexOf(id) >= shown);
  return waiting && retryAt !== undefined ? { order: next, retryAt } : { order: next };
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

/** The first (newest) share fills the stage; cameras and any other share sit in the side strip. */
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
    /** Camera identities in stage order, from useSpeakerOrder; omitted, the room's own order. */
    speakerOrder?: readonly string[];
    /**
     * Screen-share sids, newest first, from useShareOrder: while a takeover
     * runs two shares are briefly on and the new one takes the stage.
     * Omitted, the room's own order.
     */
    shareOrder?: readonly string[];
  },
): ConferenceStage {
  const {
    layout,
    maxTiles,
    page,
    pinnedIdentity = null,
    hiddenIdentities = [],
    hideWithoutVideo = false,
    speakerOrder = [],
    shareOrder = [],
  } = options;

  const visible = filterVisibleTracks(tracks, hiddenIdentities, hideWithoutVideo);
  const { screenShares, cameras } = splitTracksBySource(visible);

  if (screenShares.length > 0) {
    return resolvePresentationStage(
      orderShares(screenShares, shareOrder),
      orderTracks(cameras, speakerOrder, pinnedIdentity),
      page,
    );
  }

  const ordered = orderTracks(visible, speakerOrder, pinnedIdentity);

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

/**
 * Whether the AI copilot panel is actually on screen. Compact screens show the
 * side panel as a Sheet, so the desktop pin (open by default) says nothing
 * about them; wide screens have no Sheet.
 */
export function copilotPanelShown({
  tab,
  compact,
  sheetOpen,
  pinned,
}: {
  tab: string;
  compact: boolean;
  sheetOpen: boolean;
  pinned: boolean;
}): boolean {
  return tab === "copilot" && (compact ? sheetOpen : pinned);
}

/** A camera frame's shape until its video reports its own. */
export const DEFAULT_CAMERA_ASPECT = 16 / 9;
/** How much narrower than its video a camera tile may get, cropping only the sides. */
const MAX_SIDE_CROP = 1.3;

/**
 * Size of a camera tile inside a `container-type: size` cell. The tile is
 * never wider than its video, so a wide window cannot crop a face top and
 * bottom (UNI-846); in a tall cell it may be up to 1.3× narrower, a bounded
 * side crop, instead of a full-height strip that shows a third of the frame.
 */
export function cameraTileSize(aspect: number, besideStrip = false): { width: string; height: string } {
  return videoTileSize(aspect, MAX_SIDE_CROP, besideStrip);
}

/**
 * Size of a screen-share tile: exactly its video's shape, never cropped. The
 * frame (ring, name, controls) then hugs the shared screen instead of the
 * cell, which letterboxed it off-centre whenever the cell changed shape, as
 * when the side panel opens.
 */
export function screenShareTileSize(aspect: number, besideStrip = false): { width: string; height: string } {
  return videoTileSize(aspect, 1, besideStrip);
}

/**
 * A presentation stage lays the main tile and its thumbnail strip out as one
 * group, centred together, so the strip sits against the tile instead of the
 * far edge of the stage. The tile is then sized from the whole stage (the
 * size container) minus the strip's room, which the stage publishes in these
 * two custom properties: a width beside the tile, a height under it.
 */
export const STRIP_RESERVE_X = "--strip-reserve-x";
export const STRIP_RESERVE_Y = "--strip-reserve-y";
function reserved(besideStrip: boolean): { w: string; h: string } {
  if (!besideStrip) return { w: "100cqw", h: "100cqh" };
  return {
    w: `(100cqw - var(${STRIP_RESERVE_X}, 0px))`,
    h: `(100cqh - var(${STRIP_RESERVE_Y}, 0px))`,
  };
}

/**
 * How many buttons a full tile's corner controls hold, mirroring what
 * MeetingTileActions draws: a camera tile has pin + menu (+ host mute); a
 * shared screen has no pin or watch toggle, so it shows host mute + menu only
 * when the host can mute, and nothing otherwise.
 */
export function tileControlButtons({ screenShare, hostMute }: { screenShare: boolean; hostMute: boolean }): number {
  if (screenShare) return hostMute ? 2 : 0;
  return hostMute ? 3 : 2;
}

/** Room a strip takes beside the main tile (w-28 + gap-3) or under it (w-24 at 4:3 + pb-1 + gap-2), in rem. */
export const STRIP_BESIDE_REM = 7.75;
export const STRIP_BELOW_REM = 5.25;

/**
 * Where the thumbnail strip goes: whichever side leaves the bigger main tile
 * for a 16:9 presentation in a stage of this size. Decided by the stage's own
 * shape, not the viewport: a portrait tablet or a narrow stage beside the
 * side panel wants the strip under the share, a wide one beside it.
 */
export function stripPlacement(width: number, height: number, remPx = 16): "beside" | "below" {
  const ar = DEFAULT_CAMERA_ASPECT;
  const besideWidth = Math.min(width - STRIP_BESIDE_REM * remPx, height * ar);
  const belowWidth = Math.min(width, (height - STRIP_BELOW_REM * remPx) * ar);
  return besideWidth > belowWidth ? "beside" : "below";
}

/** A tile with no video shape (the presenter's own card) fills the stage's room. */
export function stageFillSize(): { width: string; height: string } {
  const { w, h } = reserved(true);
  return { width: `calc${w}`, height: `calc${h}` };
}

function videoTileSize(
  aspect: number,
  maxSideCrop: number,
  besideStrip: boolean,
): { width: string; height: string } {
  const ar = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_CAMERA_ASPECT;
  const round = (n: number) => Number(n.toFixed(4));
  const { w, h } = reserved(besideStrip);
  return {
    width: `min(${w}, calc(${h} * ${round(ar)}))`,
    height: `min(${h}, calc(${w} * ${round(maxSideCrop / ar)}))`,
  };
}

export type TileRingTone = "hand" | "speaking" | "pinned" | "idle";

/**
 * One ring per tile, by urgency: a raised hand asks for the room's attention,
 * speaking says who to look at, pinning is only the viewer's own layout.
 */
export function tileRingTone({
  handRaised,
  speaking,
  pinned,
}: {
  handRaised: boolean;
  speaking: boolean;
  pinned: boolean;
}): TileRingTone {
  if (handRaised) return "hand";
  if (speaking) return "speaking";
  if (pinned) return "pinned";
  return "idle";
}
