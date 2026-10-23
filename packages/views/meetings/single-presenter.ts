/** Two shares started this close together are a race, not a takeover. */
export const PRESENTER_RACE_MS = 3000;

/**
 * How long the side that loses a race on identity waits before it stops: long
 * enough for the other side's stop to reach us when that side read the same
 * pair of shares as a takeover instead.
 */
export const PRESENTER_RACE_GRACE_MS = 2000;

type Presenter = { identity: string; since: number };

/**
 * Whether our screen share gives way to another one: one share at a time, and
 * the newer one keeps the stage ("yield"). Each client only knows when it
 * first saw a share, so two shares started within `raceMs` of each other are
 * settled by identity instead (the greater keeps presenting). That loser stops
 * only if the other share is still on after PRESENTER_RACE_GRACE_MS
 * ("yield-if-still-on"): near the race edge the other presenter, measuring
 * with its own network delay, can read a takeover and stop at once, and then
 * ours is the one left presenting rather than nobody.
 */
export function presenterVerdict(
  own: Presenter,
  other: Presenter,
  raceMs = PRESENTER_RACE_MS,
): "stay" | "yield" | "yield-if-still-on" {
  const gap = other.since - own.since;
  if (gap > raceMs) return "yield";
  if (gap < -raceMs) return "stay";
  return other.identity > own.identity ? "yield-if-still-on" : "stay";
}
