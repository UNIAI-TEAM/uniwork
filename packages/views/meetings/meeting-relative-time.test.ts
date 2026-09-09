import { describe, expect, it } from "vitest";
import { formatRelativeTime, meetingDurationParts } from "./meeting-relative-time";

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
