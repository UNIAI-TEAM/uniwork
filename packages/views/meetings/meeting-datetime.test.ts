import { describe, expect, it } from "vitest";
import { formatMeetingRange, formatMeetingTimes, formatRemaining } from "./meeting-datetime";

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
    const s = formatMeetingRange("2026-08-28T02:00:00Z", "2026-08-28T02:30:00Z", "Asia/Ho_Chi_Minh", "vi-VN");
    expect(s).toContain("09:00");
    expect(s).toContain("09:30");
    expect(s.match(/2026/g)?.length ?? 0).toBe(1);
  });

  it("returns an empty string for unparseable stamps", () => {
    expect(formatMeetingRange("x", "y")).toBe("");
  });
});

describe("formatMeetingTimes", () => {
  it("is time-only in the meeting's zone", () => {
    expect(formatMeetingTimes("2026-08-28T02:00:00Z", "2026-08-28T02:30:00Z", "Asia/Ho_Chi_Minh", "en-GB")).toMatch(/^09:00\s*[–-]\s*09:30$/);
  });
});
