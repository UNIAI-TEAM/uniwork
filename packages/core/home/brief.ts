import type { HomeSummary } from "../types/home";

/** The sentence under the greeting: an i18n key, its values, and a time to format. */
export interface HomeHeadline {
  key: string;
  params: Record<string, string | number>;
  at?: string;
  /** A meeting in progress, which the greeting offers to join. */
  liveMeetingId?: string;
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Whole days a due date lies before `today` (both YYYY-MM-DD); 0 when not overdue. */
export function overdueDays(today: string, due: string | undefined): number {
  if (!due) return 0;
  const t = dayNumber(today);
  const d = dayNumber(due);
  if (t === null || d === null) return 0;
  return Math.max(0, t - d);
}

/**
 * The oldest open overdue task (My work is sorted oldest due first). A task
 * completed on the page stays in the cache, dimmed, until the refetch; it is
 * no longer overdue.
 */
export function oldestOverdue(summary: HomeSummary): HomeSummary["my_work"][number] | undefined {
  return summary.my_work.find((t) => t.status !== "done" && overdueDays(summary.today, t.due_date) > 0);
}

/** Calendar day of an instant in the person's zone, as YYYY-MM-DD. */
export function localDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * The one sentence under the greeting: the thing to look at first, derived
 * from the summary the page already has. A meeting in progress comes first (it
 * is urgent by the minute, and its source did load); then a failed source,
 * because its zeros are not true; then the oldest overdue task, the next meeting starting today, what is
 * due today, what is unread, and otherwise a clear day. It names what the stat tiles cannot (a title, a time) rather than
 * repeating their numbers. `at` is a meeting start for the view to format.
 */
export function buildHomeHeadline(summary: HomeSummary): HomeHeadline {
  const { counts, today } = summary;
  const live = summary.upcoming_meetings.find((m) => m.status === "IN_PROGRESS");
  if (live) return { key: "home.headline.live", params: { title: live.title }, liveMeetingId: live.id };
  if (summary.partial.length > 0) return { key: "home.headline.partial", params: {} };
  if (counts.overdue > 0) {
    const oldest = oldestOverdue(summary);
    return oldest
      ? { key: "home.headline.overdue", params: { title: oldest.title, count: overdueDays(today, oldest.due_date) } }
      : { key: "home.headline.overdue_plain", params: { count: counts.overdue } };
  }
  if (counts.meetings_today > 0) {
    const next = nextMeetingToday(summary);
    if (next) return { key: "home.headline.meeting", params: { title: next.title }, at: next.starts_at };
  }
  if (counts.due_today > 0) return { key: "home.headline.due_today", params: { count: counts.due_today } };
  if (counts.unread > 0) return { key: "home.headline.unread", params: { count: counts.unread } };
  return { key: "home.headline.clear", params: {} };
}

/** The first meeting of today that has not started yet. */
export function nextMeetingToday(summary: HomeSummary): HomeSummary["upcoming_meetings"][number] | undefined {
  return summary.upcoming_meetings.find(
    (m) => m.status !== "IN_PROGRESS" && localDay(m.starts_at, summary.timezone || "UTC") === summary.today,
  );
}
