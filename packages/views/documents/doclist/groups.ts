// The time groups of the list screens that group (recent, shared, trash) and
// the "N days left" count of the trash. Pure functions of `now`, so the
// boundaries (Monday 00:00, yesterday on a Monday, 7 and 8 days) are testable;
// doclist-vectors.json holds them for the web and the desktop app alike.

export type DocListGroupScreen = "recent" | "shared" | "trash";
export type DocListGroupId = "today" | "yesterday" | "this_week" | "earlier" | "deleting_soon" | "more_than_7_days";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A trashed item at or under this many days left is "Sắp xóa vĩnh viễn". */
const DELETING_SOON_DAYS = 7;

function parse(at: string | null | undefined): Date | null {
  if (!at) return null;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date, offsetDays = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();
}

/** Monday 00:00 of the week `now` falls in (local time). */
function startOfWeek(now: Date): number {
  return startOfDay(now, -((now.getDay() + 6) % 7));
}

/**
 * Whole days a trashed item has left: max(1, ceil((purge_after - now) / 24h)),
 * so the last day still reads "1 day". Null when there is no usable date.
 */
export function daysLeft(purgeAfter: string | null | undefined, now: Date): number | null {
  const purge = parse(purgeAfter);
  if (!purge) return null;
  return Math.max(1, Math.ceil((purge.getTime() - now.getTime()) / DAY_MS));
}

/**
 * The group a row sits in. Recent: Hôm nay / Hôm qua / Tuần này (from Monday
 * 00:00, minus today and yesterday) / Trước đó. Shared: Tuần này / Trước đó, so
 * yesterday on a Monday is the week before. Trash: Sắp xóa vĩnh viễn at 7 days
 * left or fewer, else Còn trên 7 ngày. A missing or invalid date is the last
 * group; a date after `now` (clock drift) counts as now.
 */
export function docListGroupId(
  screen: DocListGroupScreen,
  input: { at?: string | null; purgeAfter?: string | null },
  now: Date,
): DocListGroupId {
  if (screen === "trash") {
    const left = daysLeft(input.purgeAfter, now);
    return left !== null && left <= DELETING_SOON_DAYS ? "deleting_soon" : "more_than_7_days";
  }
  const at = parse(input.at);
  if (!at) return "earlier";
  const time = at.getTime();
  if (screen === "recent") {
    if (time >= startOfDay(now)) return "today";
    if (time >= startOfDay(now, -1)) return "yesterday";
  }
  return time >= startOfWeek(now) ? "this_week" : "earlier";
}

/** The translation key of a group header. */
export function docListGroupLabelKey(id: DocListGroupId): string {
  return `documents.list.group.${id}`;
}
