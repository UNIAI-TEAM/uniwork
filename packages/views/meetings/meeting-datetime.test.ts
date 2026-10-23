import { describe, expect, it } from "vitest";
import {
  combineLocalIso,
  defaultScheduleDraft,
  formatMeetingDay,
  formatMeetingRange,
  formatMeetingTimes,
  formatRemaining,
  meetingDayKey,
  meetingLocale,
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

describe("formatMeetingRange", () => {
  it("prints the date once when both ends fall on the same day", () => {
    const s = formatMeetingRange("2026-08-28T02:00:00Z", "2026-08-28T02:30:00Z", "vi-VN");
    expect(s).toMatch(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/);
    expect(s.match(/2026/g)?.length ?? 0).toBe(1);
  });

  it("returns an empty string for unparseable stamps", () => {
    expect(formatMeetingRange("x", "y")).toBe("");
    expect(formatMeetingRange("2026-08-28T02:00:00Z", "not-a-date")).toBe("");
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
