/** Calendar-day helpers for gantt date parsing and bucketing. */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

function parseParts(value: string): [number, number, number] | null {
  const m = DATE_ONLY.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** Date at UTC midnight of the calendar day — timezone-safe for axis buckets. */
export function dateOnlyToUTCDate(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const parts = parseParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export function isWeekendUTC(d: Date): boolean {
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

export function isMonthStartUTC(d: Date): boolean {
  return d.getUTCDate() === 1;
}

export function isWeekStartUTC(d: Date): boolean {
  return d.getUTCDay() === 1;
}
