const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

const WEEK = 7 * 86400;

// Formatters are costly to build and a list renders one per row per tick.
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  let f = relativeFormats.get(locale);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormats.set(locale, f);
  }
  return f;
}

function dateFormat(locale: string, withYear: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${withYear ? "y" : ""}`;
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
    dateFormats.set(key, f);
  }
  return f;
}

/**
 * "5 phút trước" / "5 minutes ago" inside the last week; under a minute reads
 * as "now". Past a week the distance stops helping ("3 tuần trước" says less
 * than the day), so it gives the date itself — the year only when it is not
 * this one. The exact time is then on screen for touch and keyboard readers
 * too, not only in a hover title.
 */
export function relativeTime(iso: string, locale: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const diff = Math.round((then.getTime() - now.getTime()) / 1000);
  if (Math.abs(diff) >= WEEK) return dateFormat(locale, then.getFullYear() !== now.getFullYear()).format(then);
  const rtf = relativeFormat(locale);
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return rtf.format(0, "second");
}

const fullFormats = new Map<string, Intl.DateTimeFormat>();

/** "Thứ Năm, 25 tháng 9, 2026 lúc 09:14": the full moment, for titles and screen readers. */
export function absoluteTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let f = fullFormats.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" });
    fullFormats.set(locale, f);
  }
  return f.format(d);
}
