import { MOTION_TITLE_MAX_LENGTH } from "@uniwork/core/meetings/motions";
import { scheduleProblems } from "../meeting-schedule-fields";
import { draftLinks, type MeetingDraft } from "./draft-model";

/**
 * The sheet's client rules, in visual order (create-ui §6.5): the first issue
 * is where submit puts the focus. `field` is the id suffix of the control.
 */
export type DraftIssueCode =
  | "titleRequired"
  | "startPassed"
  | "endSame"
  | "quorumInvalid"
  | "linkLimit"
  | "motionEmpty"
  | "motionTooLong";

export type DraftIssue = { field: string; code: DraftIssueCode };

/** Empty is "no minimum" (0, which the server reads as clearing it); else an integer 1–100. */
export function parseQuorum(text: string): { value: number; invalid: boolean } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: 0, invalid: false };
  const value = Number(trimmed);
  return { value, invalid: !/^\d+$/.test(trimmed) || value < 1 || value > 100 };
}

/** A guest link's limit: "" = none; else a whole number ≥ 1. */
export function parseLimit(text: string): { value: number | undefined; invalid: boolean } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: undefined, invalid: false };
  const value = Number(trimmed);
  return { value, invalid: !/^\d+$/.test(trimmed) || value < 1 };
}

export function motionIssue(title: string): DraftIssueCode | null {
  const trimmed = title.trim();
  if (!trimmed) return "motionEmpty";
  if (trimmed.length > MOTION_TITLE_MAX_LENGTH) return "motionTooLong";
  return null;
}

/** Minutes from start to end; an end at or before the start runs into the next day. */
export function durationMinutes(start: string, end: string): number {
  const toMin = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(":").map((x) => Number.parseInt(x, 10) || 0);
    return h * 60 + m;
  };
  return (((toMin(end) - toMin(start)) % 1440) + 1440) % 1440;
}

/** "HH:MM" moved by `minutes`, wrapping past midnight. */
export function plusMinutes(hhmm: string, minutes: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map((x) => Number.parseInt(x, 10) || 0);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const QUARTER = 15 * 60 * 1000;

/** The first quarter hour at or after `nowMs` (21:18 → 21:30), for "Dời sang 21:30". */
export function nextQuarterHour(nowMs: number): number {
  return Math.ceil(nowMs / QUARTER) * QUARTER;
}

export function validateDraft(
  draft: MeetingDraft,
  opts: { nowMs: number; checkPast: boolean; timeLocked?: boolean; existingLinkKeys?: ReadonlySet<string> },
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!draft.title.trim()) issues.push({ field: "title", code: "titleRequired" });
  if (!opts.timeLocked) {
    const problems = scheduleProblems({
      date: draft.date,
      start: draft.start,
      end: draft.end,
      timeZone: draft.timezone,
      nowMs: opts.nowMs,
      checkPast: opts.checkPast,
    });
    if (problems.startPassed) issues.push({ field: "start", code: "startPassed" });
    if (problems.endInvalid) issues.push({ field: "end", code: "endSame" });
  }
  for (const link of draftLinks(draft)) {
    const limit = parseLimit(link.maxUses);
    if (limit.invalid || (link.access === "AUTO_ADMIT" && limit.value === undefined)) {
      issues.push({ field: `link-${link.key}`, code: "linkLimit" });
    }
  }
  for (const motion of draft.motions) {
    if (motion.status && motion.status !== "DRAFT") continue;
    const code = motionIssue(motion.title);
    if (code) issues.push({ field: `motion-${motion.key}`, code });
  }
  if (parseQuorum(draft.quorum).invalid) issues.push({ field: "quorum", code: "quorumInvalid" });
  return issues;
}
