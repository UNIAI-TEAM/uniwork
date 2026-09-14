import type { HomeSummary } from "../types/home";

/** One sentence of the daily brief: an i18n key and its interpolation values. */
export interface HomeBriefLine {
  key: string;
  params: Record<string, string | number>;
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

/** Calendar day of an instant in the person's zone, as YYYY-MM-DD. */
function localDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * The brief is derived from the summary the page already has: what is overdue
 * (naming the oldest), the next meeting today, what is due today, what is
 * unread. Nothing to say means no lines, never a line about zero. At most three.
 */
export function buildHomeBrief(summary: HomeSummary): HomeBriefLine[] {
  const { counts, today } = summary;
  const lines: HomeBriefLine[] = [];

  if (counts.overdue > 0) {
    const oldest = summary.my_work.find((t) => overdueDays(today, t.due_date) > 0);
    lines.push(
      oldest
        ? { key: "home.brief.overdue", params: { count: counts.overdue, title: oldest.title, days: overdueDays(today, oldest.due_date) } }
        : { key: "home.brief.overdue_plain", params: { count: counts.overdue } },
    );
  }
  if (counts.meetings_today > 0) {
    const next = summary.upcoming_meetings.find(
      (m) => m.status !== "IN_PROGRESS" && localDay(m.starts_at, summary.timezone || "UTC") === today,
    );
    lines.push(
      next
        ? { key: "home.brief.meetings", params: { count: counts.meetings_today, title: next.title } }
        : { key: "home.brief.meetings_plain", params: { count: counts.meetings_today } },
    );
  }
  if (counts.due_today > 0) lines.push({ key: "home.brief.due_today", params: { count: counts.due_today } });
  if (counts.unread > 0) lines.push({ key: "home.brief.unread", params: { count: counts.unread } });
  return lines.slice(0, 3);
}
