import { describe, expect, it } from "vitest";
import {
  addDays,
  dateOnlyToUTCDate,
  daysBetween,
  isMonthStartUTC,
  isWeekStartUTC,
  isWeekendUTC,
  MS_PER_DAY,
  startOfDayUTC,
} from "./gantt-date";

describe("gantt-date", () => {
  it("parses YYYY-MM-DD and rejects empty or invalid values", () => {
    expect(dateOnlyToUTCDate(null)).toBeNull();
    expect(dateOnlyToUTCDate(undefined)).toBeNull();
    expect(dateOnlyToUTCDate("")).toBeNull();
    expect(dateOnlyToUTCDate("not-a-date")).toBeNull();

    const d = dateOnlyToUTCDate("2026-03-15");
    expect(d?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("falls back to UTC calendar parts for ISO timestamps", () => {
    const d = dateOnlyToUTCDate("2026-03-15T18:30:00.000Z");
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(2);
    expect(d?.getUTCDate()).toBe(15);
  });

  it("normalizes to UTC midnight and adds whole days", () => {
    const noon = new Date(Date.UTC(2026, 2, 15, 12, 0, 0));
    const start = startOfDayUTC(noon);
    expect(start.toISOString()).toBe("2026-03-15T00:00:00.000Z");

    const next = addDays(start, 2);
    expect(next.toISOString()).toBe("2026-03-17T00:00:00.000Z");
    expect(daysBetween(start, next)).toBe(2);
    expect(MS_PER_DAY).toBe(24 * 60 * 60 * 1000);
  });

  it("detects weekends, month starts, and Monday week starts in UTC", () => {
    const saturday = new Date(Date.UTC(2026, 2, 14));
    const sunday = new Date(Date.UTC(2026, 2, 15));
    const monday = new Date(Date.UTC(2026, 2, 16));
    const first = new Date(Date.UTC(2026, 3, 1));

    expect(isWeekendUTC(saturday)).toBe(true);
    expect(isWeekendUTC(sunday)).toBe(true);
    expect(isWeekendUTC(monday)).toBe(false);

    expect(isWeekStartUTC(monday)).toBe(true);
    expect(isWeekStartUTC(sunday)).toBe(false);

    expect(isMonthStartUTC(first)).toBe(true);
    expect(isMonthStartUTC(monday)).toBe(false);
  });
});
