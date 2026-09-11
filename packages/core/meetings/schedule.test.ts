import { describe, expect, it } from "vitest";
import {
  canEnterScheduledMeeting,
  displayMeetingStatus,
  isPastScheduledEnd,
  isScheduledMeetingLive,
  msUntilScheduledEnd,
} from "./schedule";

describe("meeting schedule helpers", () => {
  const endsAt = "2026-09-03T10:00:00.000Z";

  it("detects past scheduled end", () => {
    expect(isPastScheduledEnd(endsAt, Date.parse("2026-09-03T10:00:01.000Z"))).toBe(true);
    expect(isPastScheduledEnd(endsAt, Date.parse("2026-09-03T10:00:00.000Z"))).toBe(false);
  });

  it("computes ms until end", () => {
    expect(msUntilScheduledEnd(endsAt, Date.parse("2026-09-03T09:59:00.000Z"))).toBe(60_000);
    expect(msUntilScheduledEnd(endsAt, Date.parse("2026-09-03T10:00:01.000Z"))).toBe(-1_000);
  });

  it("blocks enter when past end or closed", () => {
    expect(
      canEnterScheduledMeeting(
        { ends_at: endsAt, status: "IN_PROGRESS" },
        Date.parse("2026-09-03T10:05:00.000Z"),
      ),
    ).toBe(false);
    expect(canEnterScheduledMeeting({ ends_at: endsAt, status: "ENDED" })).toBe(false);
    expect(
      canEnterScheduledMeeting(
        { ends_at: endsAt, status: "IN_PROGRESS" },
        Date.parse("2026-09-03T09:59:00.000Z"),
      ),
    ).toBe(true);
  });

  it("treats overtime IN_PROGRESS as not live and as ended for display", () => {
    const past = Date.parse("2026-09-03T10:05:00.000Z");
    const inside = Date.parse("2026-09-03T09:59:00.000Z");
    expect(isScheduledMeetingLive({ ends_at: endsAt, status: "IN_PROGRESS" }, past)).toBe(false);
    expect(isScheduledMeetingLive({ ends_at: endsAt, status: "IN_PROGRESS" }, inside)).toBe(true);
    expect(displayMeetingStatus({ ends_at: endsAt, status: "IN_PROGRESS" }, past)).toBe("ENDED");
    expect(displayMeetingStatus({ ends_at: endsAt, status: "IN_PROGRESS" }, inside)).toBe("IN_PROGRESS");
    expect(displayMeetingStatus({ ends_at: endsAt, status: "CANCELED" }, past)).toBe("CANCELED");
  });
});
