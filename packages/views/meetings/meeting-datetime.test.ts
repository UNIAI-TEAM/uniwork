import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  meetingDurationParts,
  combineLocalIso,
  defaultScheduleDraft,
  formatMeetingDay,
  formatMeetingRange,
  formatMeetingTimes,
  formatRemaining,
  meetingDayKey,
  meetingLocale,
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

describe("meetingDurationParts", () => {
  it("splits a span into whole hours and remaining minutes", () => {
    expect(meetingDurationParts("2026-08-28T02:00:00Z", "2026-08-28T02:30:00Z")).toEqual({ hours: 0, minutes: 30 });
    expect(meetingDurationParts("2026-08-28T02:00:00Z", "2026-08-28T03:45:00Z")).toEqual({ hours: 1, minutes: 45 });
    expect(meetingDurationParts("2026-08-28T02:00:00Z", "2026-08-28T04:00:00Z")).toEqual({ hours: 2, minutes: 0 });
  });

  it("returns null for an unusable or inverted span", () => {
    expect(meetingDurationParts("bad", "2026-08-28T02:30:00Z")).toBeNull();
    expect(meetingDurationParts("2026-08-28T03:00:00Z", "2026-08-28T02:30:00Z")).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-09-08T08:00:00Z");

  it("picks the largest unit that fits and keeps the sign", () => {
    expect(formatRelativeTime("2026-09-08T10:00:00Z", "en-GB", now)).toBe("in 2 hours");
    expect(formatRelativeTime("2026-09-08T07:15:00Z", "en-GB", now)).toBe("45 minutes ago");
    expect(formatRelativeTime("2026-09-11T08:00:00Z", "en-GB", now)).toBe("in 3 days");
    expect(formatRelativeTime("2026-09-08T08:00:20Z", "en-GB", now)).toBe("now");
  });

  it("speaks Vietnamese for the vi locale and is empty for bad input", () => {
    expect(formatRelativeTime("2026-09-08T10:00:00Z", "vi-VN", now)).toBe("sau 2 giờ nữa");
    expect(formatRelativeTime("not-a-date", "vi-VN", now)).toBe("");
  });
});
