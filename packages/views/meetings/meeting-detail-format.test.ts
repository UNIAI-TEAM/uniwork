import { describe, expect, it } from "vitest";
import { meetingTimeZoneLabel } from "./meeting-detail-format";

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
