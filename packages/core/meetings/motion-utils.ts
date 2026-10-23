import type { MyMotionBallot } from "../api/endpoints/meeting-motions";
import type { MeetingMotion } from "../types/meeting";

/** MeetingService's limits (motionTitleMax / motionDescriptionMax), in runes after trimming. */
export const MOTION_TITLE_MAX_LENGTH = 200;
export const MOTION_DESCRIPTION_MAX_LENGTH = 2000;

/** Code points, the way Go counts runes: "ệ" is one, an emoji is one. */
function runeCount(value: string): number {
  return [...value].length;
}

/** What a threshold is measured against (motionDenominator in Go). */
export function motionDenominator(base: string, rollSize: number, totalMembers: number): number {
  return base === "ALL_MEMBERS" ? totalMembers : rollSize;
}

/**
 * Fewest votes in favour that pass (requiredYes in Go): a majority is strictly
 * more than half, two-thirds is at least two thirds. 0 when nobody could vote;
 * such an item always fails. An unknown threshold reads as a majority.
 */
export function requiredYes(threshold: string, denominator: number): number {
  if (denominator <= 0) return 0;
  if (threshold === "TWO_THIRDS") return Math.floor((2 * denominator + 2) / 3);
  return Math.floor(denominator / 2) + 1;
}

/** Whether the motion form may submit: the same checks the server makes. */
export function canSubmitMotion(title: string, description: string): boolean {
  const titleLength = runeCount(title.trim());
  return (
    titleLength >= 1 &&
    titleLength <= MOTION_TITLE_MAX_LENGTH &&
    runeCount(description.trim()) <= MOTION_DESCRIPTION_MAX_LENGTH
  );
}

/**
 * The motion list is the same for every caller; the caller's own roll is a
 * separate read (GET /my-ballots). This joins them into `my_ballot`, which
 * the cards, the vote prompt and the tab badge read. Until the roll is known
 * (loading, failed, drifted) the list is returned as it came.
 */
export function withMyBallots(
  motions: MeetingMotion[],
  ballots: readonly MyMotionBallot[] | null | undefined,
): MeetingMotion[] {
  if (!ballots) return motions;
  const mine = new Map(ballots.map((b) => [b.motion_id, b]));
  return motions.map((m) => {
    const b = mine.get(m.id);
    return {
      ...m,
      my_ballot: b ? { on_roll: true, cast: b.cast, choice: b.choice ?? null } : { on_roll: false, cast: false, choice: null },
    };
  });
}

/** The open item waiting for my ballot, if any (at most one is open per meeting). */
export function pendingBallot(motions: readonly MeetingMotion[] | undefined): MeetingMotion | null {
  return (
    motions?.find((m) => m.status === "OPEN" && m.my_ballot?.on_roll === true && m.my_ballot.cast !== true) ?? null
  );
}

/**
 * The room's Votes tab: a clerk always sees it (to draft); everyone else, guests
 * included, once an item has left draft. `pending` drives the tab badge.
 */
export function motionsTabState(
  motions: readonly MeetingMotion[] | undefined,
  isClerk: boolean,
): { visible: boolean; pending: boolean } {
  const list = motions ?? [];
  return {
    visible: isClerk || list.some((m) => m.status !== "DRAFT"),
    pending: pendingBallot(list) !== null,
  };
}

/**
 * A share of `total` as a whole percent for the result bar. A non-zero count
 * never reads as 0%, and a share short of the total never reads as 100%.
 */
export function tallyPercent(count: number, total: number): number {
  if (total <= 0 || count <= 0) return 0;
  if (count >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((count * 100) / total)));
}
