import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  combineLocalIso,
  defaultScheduleDraft,
  formatMeetingDate,
  formatMeetingDay,
  formatMeetingTimes,
  formatMeetingWindow,
  formatRemaining,
  meetingDayKey,
  meetingLocale,
  meetingShownWindow,
  meetingWindowParts,
  sameUtcOffset,
  scheduleWindowIso,
  splitIsoLocal,
} from "./meeting-datetime";

describe("formatRemaining", () => {
  it("returns a padded H:MM:SS countdown", () => {
    const now = Date.parse("2026-08-28T00:00:00Z");
    expect(formatRemaining("2026-08-29T07:12:30Z", now)).toBe("31:12:30");
  });

  it("clamps to zero after the meeting has ended", () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    expect(formatRemaining("2026-08-28T11:00:00Z", now)).toBe("00:00:00");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatRemaining("not-a-date")).toBeNull();
  });
});

/** A wall-clock moment in the test runner's own zone, as the ISO the API sends. */
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();
const t = ((key: string, o?: Record<string, unknown>) =>
  key === "meetings.timesNextDay" ? `${String(o?.times)} (hôm sau)` : `${String(o?.day)} · ${String(o?.times)}`) as never;

describe("meetingWindowParts and formatMeetingWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells a same-day window as the hero does: the day, then the clock span", () => {
    const parts = meetingWindowParts(local(2026, 10, 21, 16, 0), local(2026, 10, 21, 16, 30), "vi-VN");
    expect(parts).toMatchObject({ dayKey: "2026-10-21", day: "Thứ Tư, 21 tháng 10", nextDay: false });
    expect(parts?.times).toMatch(/^16:00\s*[–-]\s*16:30$/);
  });

  it("marks a window past midnight as ending the next day, never with two dated stamps", () => {
    const s = formatMeetingWindow(local(2026, 10, 21, 23, 57), local(2026, 10, 22, 0, 57), "vi-VN", t);
    expect(s).toBe("Thứ Tư, 21 tháng 10 · 23:57 – 00:57 (hôm sau)");
  });

  it("names the end's day when the window runs longer than a night", () => {
    const parts = meetingWindowParts(local(2026, 10, 21, 9, 0), local(2026, 10, 23, 17, 0), "vi-VN");
    expect(parts?.times).toBe("09:00 – Thứ Sáu, 23 tháng 10, 17:00");
    expect(parts?.nextDay).toBe(false);
  });

  it("says the year of a window in another year", () => {
    expect(meetingWindowParts(local(2025, 10, 21, 9, 0), local(2025, 10, 21, 10, 0), "vi-VN")?.day).toBe(
      "Thứ Ba, 21 tháng 10, 2025",
    );
  });

  it("is empty for unparseable stamps", () => {
    expect(meetingWindowParts("x", "y")).toBeNull();
    expect(formatMeetingWindow("2026-08-28T02:00:00Z", "not-a-date", "vi-VN", t)).toBe("");
  });
});

describe("formatMeetingTimes", () => {
  it("is time-only, in the viewer's zone", () => {
    expect(formatMeetingTimes("2026-08-28T02:00:00Z", "2026-08-28T02:30:00Z", "en-GB")).toMatch(/^\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}$/);
  });
});

describe("splitIsoLocal", () => {
  it("splits valid timestamps and falls back for invalid input", () => {
    expect(splitIsoLocal("2026-08-28T14:30:00Z").date).toBe("2026-08-28");
    const invalid = splitIsoLocal("not-a-date");
    expect(invalid.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(invalid.time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("combineLocalIso", () => {
  it("combines date and time or falls back to now", () => {
    expect(combineLocalIso("2026-08-28", "09:30")).toContain("2026-08-28");
    expect(combineLocalIso("bad", "bad")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("meetingLocale", () => {
  it("maps i18n language to a BCP 47 tag", () => {
    expect(meetingLocale("en")).toBe("en-GB");
    expect(meetingLocale("en-US")).toBe("en-GB");
    expect(meetingLocale("vi")).toBe("vi-VN");
    expect(meetingLocale(undefined)).toBe("vi-VN");
  });
});

describe("meetingDayKey and formatMeetingDay", () => {
  it("groups by local day and formats headings", () => {
    expect(meetingDayKey("2026-08-28T23:30:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatMeetingDay("2026-08-28", "vi-VN")).toContain("28");
    expect(formatMeetingDay("not-a-day")).toBe("not-a-day");
  });

  it("adds the year only to a day outside the current one", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 22, 9, 0));
      expect(formatMeetingDay("2026-10-21", "vi-VN")).toBe("Thứ Tư, 21 tháng 10");
      expect(formatMeetingDay("2025-10-21", "vi-VN")).toBe("Thứ Ba, 21 tháng 10, 2025");
      expect(formatMeetingDay("2025-10-21", "en-GB")).toMatch(/^Tuesday,? 21 October 2025$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("formatMeetingDate", () => {
  it("prints a timestamp as a day/month/year date, and nothing for a missing or bad one", () => {
    expect(formatMeetingDate("2026-08-28T05:00:00Z", "vi-VN")).toBe("28/08/2026");
    expect(formatMeetingDate(null, "vi-VN")).toBe("");
    expect(formatMeetingDate("not-a-date", "en-GB")).toBe("");
  });
});

describe("defaultScheduleDraft", () => {
  it("returns the next whole hour with a thirty-minute end", () => {
    const draft = defaultScheduleDraft();
    expect(draft.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(draft.start).toMatch(/^\d{2}:\d{2}$/);
    expect(draft.end).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("zone-aware split/combine", () => {
  it("reads a stored instant as wall-clock time in the meeting's zone", () => {
    // 02:00Z is 11:00 in Tokyo and 09:00 in Ho Chi Minh City.
    expect(splitIsoLocal("2026-08-28T02:00:00Z", "Asia/Tokyo")).toEqual({ date: "2026-08-28", time: "11:00" });
    expect(splitIsoLocal("2026-08-28T02:00:00Z", "Asia/Ho_Chi_Minh")).toEqual({ date: "2026-08-28", time: "09:00" });
    // 20:30Z crosses midnight in Tokyo.
    expect(splitIsoLocal("2026-08-28T20:30:00Z", "Asia/Tokyo")).toEqual({ date: "2026-08-29", time: "05:30" });
  });

  it("turns wall-clock time typed in a zone into the right instant", () => {
    expect(combineLocalIso("2026-08-28", "11:00", "Asia/Tokyo")).toBe("2026-08-28T02:00:00.000Z");
    expect(combineLocalIso("2026-08-28", "09:00", "Asia/Ho_Chi_Minh")).toBe("2026-08-28T02:00:00.000Z");
    expect(combineLocalIso("2026-08-29", "05:30", "Asia/Tokyo")).toBe("2026-08-28T20:30:00.000Z");
    expect(combineLocalIso("2026-08-28", "00:00", "UTC")).toBe("2026-08-28T00:00:00.000Z");
  });

  it("follows New York across both DST boundaries", () => {
    // EST (UTC-5) before 2026-03-08 02:00, EDT (UTC-4) after.
    expect(combineLocalIso("2026-03-07", "09:00", "America/New_York")).toBe("2026-03-07T14:00:00.000Z");
    expect(combineLocalIso("2026-03-08", "09:00", "America/New_York")).toBe("2026-03-08T13:00:00.000Z");
    expect(combineLocalIso("2026-03-08", "01:30", "America/New_York")).toBe("2026-03-08T06:30:00.000Z");
    // 02:30 does not exist that night; like the browser, it moves forward to 03:30 EDT.
    expect(combineLocalIso("2026-03-08", "02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 happens twice on 2026-11-01; the first (EDT) one wins.
    expect(combineLocalIso("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    expect(combineLocalIso("2026-11-01", "09:00", "America/New_York")).toBe("2026-11-01T14:00:00.000Z");
    expect(splitIsoLocal("2026-11-01T14:00:00Z", "America/New_York")).toEqual({ date: "2026-11-01", time: "09:00" });
    expect(splitIsoLocal("2026-03-08T13:00:00Z", "America/New_York")).toEqual({ date: "2026-03-08", time: "09:00" });
  });

  it("round-trips every quarter hour of a DST day", () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      if (time >= "02:00" && time < "03:00") continue; // the skipped hour
      const iso = combineLocalIso("2026-03-08", time, "America/New_York");
      expect(splitIsoLocal(iso, "America/New_York")).toEqual({ date: "2026-03-08", time });
    }
  });

  it("falls back to the browser zone for an unknown zone", () => {
    expect(combineLocalIso("2026-08-28", "09:30", "Not/AZone")).toBe(combineLocalIso("2026-08-28", "09:30"));
    expect(splitIsoLocal("2026-08-28T02:00:00Z", "Not/AZone")).toEqual(splitIsoLocal("2026-08-28T02:00:00Z"));
  });

  it("formats a range in a given zone", () => {
    expect(formatMeetingTimes("2026-08-28T02:00:00Z", "2026-08-28T02:30:00Z", "en-GB", "Asia/Tokyo")).toMatch(/^11:00\s*[–-]\s*11:30$/);
  });
});

describe("scheduleWindowIso", () => {
  it("puts an end at or before the start on the next day", () => {
    expect(scheduleWindowIso("2026-08-28", "23:30", "00:15", "Asia/Ho_Chi_Minh")).toEqual({
      starts_at: "2026-08-28T16:30:00.000Z",
      ends_at: "2026-08-28T17:15:00.000Z",
      overnight: true,
    });
    expect(scheduleWindowIso("2026-08-28", "09:00", "09:30", "Asia/Tokyo")).toEqual({
      starts_at: "2026-08-28T00:00:00.000Z",
      ends_at: "2026-08-28T00:30:00.000Z",
      overnight: false,
    });
  });
});

describe("sameUtcOffset", () => {
  it("compares zones by their offset at an instant, not by name", () => {
    const at = Date.parse("2026-08-28T02:00:00Z");
    expect(sameUtcOffset("Asia/Saigon", "Asia/Ho_Chi_Minh", at)).toBe(true);
    expect(sameUtcOffset("Asia/Tokyo", "Asia/Ho_Chi_Minh", at)).toBe(false);
    expect(sameUtcOffset("Europe/London", "UTC", Date.parse("2026-01-10T00:00:00Z"))).toBe(true);
    expect(sameUtcOffset("Europe/London", "UTC", at)).toBe(false);
  });
});

describe("meetingShownWindow", () => {
  const m = { starts_at: "2026-10-21T13:15:00Z", ends_at: "2026-10-21T14:15:00Z" };
  const ran = { actual_start_at: "2026-10-21T13:16:00Z", actual_end_at: "2026-10-21T13:18:00Z" };
  it("reads an ended meeting by its actual run", () => {
    expect(meetingShownWindow({ ...m, ...ran }, true)).toEqual({ startsAt: ran.actual_start_at, endsAt: ran.actual_end_at });
  });
  it("keeps the schedule before the end, or when either actual time is missing or bad", () => {
    const scheduled = { startsAt: m.starts_at, endsAt: m.ends_at };
    expect(meetingShownWindow({ ...m, ...ran }, false)).toEqual(scheduled);
    expect(meetingShownWindow({ ...m, actual_start_at: ran.actual_start_at }, true)).toEqual(scheduled);
    expect(meetingShownWindow({ ...m, actual_start_at: "x", actual_end_at: ran.actual_end_at }, true)).toEqual(scheduled);
  });
});
