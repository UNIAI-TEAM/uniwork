import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";

export const TILES_PER_PAGE = 9;

/** CSS grid columns for the conference stage. Keep tiles inside the shell. */
export function tileGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 6) return "grid-cols-2 lg:grid-cols-3";
  return "grid-cols-3";
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
): TrackReferenceOrPlaceholder[] {
  const rank = (t: TrackReferenceOrPlaceholder): number => {
    if (t.source === Track.Source.ScreenShare) return 0;
    const i = speakingIdentities.indexOf(t.participant.identity);
    return i === -1 ? 1_000_000 : 1 + i;
  };
  return tracks
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

export function paginate<T>(items: readonly T[], page: number, perPage = TILES_PER_PAGE): { items: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safe = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(safe * perPage, safe * perPage + perPage), pages, page: safe };
}
