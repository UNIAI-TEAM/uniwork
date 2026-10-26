// When a follow-up comes due (MobileActions board: "Theo dõi sau · 2 giờ nữa"):
// the long-press sheet names the delay, the command sets it.

export const FOLLOW_UP_HOURS = 2;

/** The due time of a follow-up made at `now` (ms since the epoch), as the server takes it. */
export function followUpDueAt(now: number): string {
  return new Date(now + FOLLOW_UP_HOURS * 60 * 60 * 1000).toISOString();
}
