import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMeetingDayTime, formatMeetingMoment, meetingTimeZoneLabel } from "./meeting-detail-format";

describe("meetingTimeZoneLabel", () => {
  it("reads an IANA id as offset and city", () => {
    expect(meetingTimeZoneLabel("Asia/Ho_Chi_Minh", "vi")).toBe("GMT+7 · Hồ Chí Minh");
    expect(meetingTimeZoneLabel("Asia/Ho_Chi_Minh", "en")).toBe("GMT+7 · Ho Chi Minh City");
    expect(meetingTimeZoneLabel("Asia/Tokyo", "vi")).toBe("GMT+9 · Tokyo");
  });

  it("keeps UTC short and survives an id the browser rejects", () => {
    expect(meetingTimeZoneLabel("UTC", "vi")).toBe("UTC");
    expect(meetingTimeZoneLabel("Mars/Olympus_Mons", "vi")).toBe("Olympus Mons");
    expect(meetingTimeZoneLabel("", "vi")).toBe("");
  });

  it("reads the offset in force at a given instant", () => {
    expect(meetingTimeZoneLabel("America/New_York", "en", new Date("2026-01-15T12:00:00Z"))).toBe("GMT-5 · New York");
    expect(meetingTimeZoneLabel("America/New_York", "en", new Date("2026-07-15T12:00:00Z"))).toBe("GMT-4 · New York");
  });
});

describe("formatMeetingDayTime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T03:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads like the hero's date, then the clock", () => {
    expect(formatMeetingDayTime("2026-10-21T08:59:00Z", "vi-VN")).toMatch(/^Thứ .+, \d{1,2} tháng 10, \d{2}:\d{2}$/);
  });

  it("names the year of a moment from another year", () => {
    expect(formatMeetingDayTime("2025-10-21T08:59:00Z", "vi-VN")).toMatch(/2025/);
  });

  it("is empty for a bad timestamp", () => {
    expect(formatMeetingDayTime("nope", "vi-VN")).toBe("");
  });
});

describe("formatMeetingMoment", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const at = (d: number, h: number, mi: number) => new Date(2026, 9, d, h, mi).toISOString();

  it("is the clock alone on the day the screen shows", () => {
    expect(formatMeetingMoment(at(21, 16, 59), "vi-VN", "2026-10-21")).toBe("16:59");
  });

  it("names the day for a moment on another one", () => {
    expect(formatMeetingMoment(at(22, 0, 12), "vi-VN", "2026-10-21")).toBe("Thứ Năm, 22 tháng 10, 00:12");
  });

  it("measures against today when no day is shown", () => {
    expect(formatMeetingMoment(at(22, 8, 30), "vi-VN")).toBe("08:30");
    expect(formatMeetingMoment(at(21, 16, 30), "vi-VN")).toBe("Thứ Tư, 21 tháng 10, 16:30");
    expect(formatMeetingMoment("nope", "vi-VN")).toBe("");
  });
});
