/** Time helpers only the detail hero needs; kept out of meeting-datetime.ts so the room route does not carry them. */

/** Whole hours and leftover minutes of a span; null when unusable or inverted. */
export function meetingDurationParts(
  startsAt: string,
  endsAt: string,
): { hours: number; minutes: number } | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const totalMin = Math.round((end - start) / 60_000);
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 3_600_000 },
  { unit: "month", ms: 30 * 24 * 3_600_000 },
  { unit: "week", ms: 7 * 24 * 3_600_000 },
  { unit: "day", ms: 24 * 3_600_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
];

/**
 * "in 2 hours" / "sau 2 giờ" / "45 minutes ago" in the largest unit that
 * fits; anything under a minute reads as "now". Empty for an unusable stamp.
 */
export function formatRelativeTime(iso: string, locale = "vi-VN", nowMs = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const delta = at - nowMs;
  const abs = Math.abs(delta);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const { unit, ms } of RELATIVE_UNITS) {
      if (abs >= ms) return rtf.format(Math.round(delta / ms), unit);
    }
    return rtf.format(0, "second");
  } catch {
    return "";
  }
}
