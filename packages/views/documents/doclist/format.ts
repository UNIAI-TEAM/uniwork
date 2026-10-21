// The one set of list formats shared by every Documents screen (and copied by
// the desktop app): the "Cập nhật" date and the "Dung lượng" size. Pure and
// locale-driven; `now` is a parameter so the day boundaries are testable.

/** What an empty or unusable value reads as in a list cell. */
export const EMPTY_CELL = "—";

const YESTERDAY: Record<"vi" | "en", string> = { vi: "Hôm qua", en: "Yesterday" };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isVietnamese(locale: string): boolean {
  return locale.toLowerCase().startsWith("vi");
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A date cell, local time, 24h in both languages: the clock today,
 * "Hôm qua, 16:30" yesterday, `18/10` (en `Oct 18`) in this year and
 * `18/10/2025` (en `Oct 18, 2025`) before. Empty or invalid reads as "—".
 * vi is written out by hand because ICU versions disagree on the separator of
 * a numeric vi date; en uses Intl for the month name only.
 * `labels.yesterday` lets a caller pass the translated word; without it the
 * built-in vi/en words apply (a test keeps them equal to the locale files).
 */
export function formatListDate(
  at: string | Date | null | undefined,
  now: Date,
  locale: string,
  labels?: { yesterday?: string },
): string {
  if (!at) return EMPTY_CELL;
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return EMPTY_CELL;
  const vi = isVietnamese(locale);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, now)) return clock;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return `${labels?.yesterday ?? YESTERDAY[vi ? "vi" : "en"]}, ${clock}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  if (vi) {
    const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
    return sameYear ? day : `${day}/${date.getFullYear()}`;
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * A file size: B, KB, MB, GB (1024), one decimal under 10 units and whole
 * from 10, the decimal mark of the locale (`2,9 KB` vi, `2.9 KB` en). Nothing
 * to show (no number, zero, a page or a folder) reads as "—"; UniNote never
 * has a size.
 */
export function formatBytes(bytes: number | null | undefined, locale: string): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return EMPTY_CELL;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  let digits = unit === 0 || value >= 10 ? 0 : 1;
  // Rounding can carry into 1024 (1023.999 KB): show it in the next unit.
  if (unit < UNITS.length - 1 && roundTo(value, digits) >= 1024) {
    value /= 1024;
    unit += 1;
    digits = value >= 10 ? 0 : 1;
  }
  return `${new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
