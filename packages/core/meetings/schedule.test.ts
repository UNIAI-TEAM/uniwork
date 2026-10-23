import { describe, expect, it } from "vitest";
import {
  canEnterScheduledMeeting,
  displayMeetingStatus,
  isPastScheduledEnd,
  isScheduledMeetingLive,
  msUntilScheduledEnd,
  nextMissedAt,
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

  it("treats overtime IN_PROGRESS as not live and as overtime for display", () => {
    const past = Date.parse("2026-09-03T10:05:00.000Z");
    const inside = Date.parse("2026-09-03T09:59:00.000Z");
    expect(isScheduledMeetingLive({ ends_at: endsAt, status: "IN_PROGRESS" }, past)).toBe(false);
    expect(isScheduledMeetingLive({ ends_at: endsAt, status: "IN_PROGRESS" }, inside)).toBe(true);
    expect(displayMeetingStatus({ ends_at: endsAt, status: "IN_PROGRESS" }, past)).toBe("OVERTIME");
    expect(displayMeetingStatus({ ends_at: endsAt, status: "IN_PROGRESS" }, inside)).toBe("IN_PROGRESS");
    // A window that passed without the meeting ever starting did not "end": it did not happen.
    expect(displayMeetingStatus({ ends_at: endsAt, status: "SCHEDULED" }, past)).toBe("MISSED");
    expect(displayMeetingStatus({ ends_at: endsAt, status: "CANCELED" }, past)).toBe("CANCELED");
  });
});

describe("nextMissedAt", () => {
  const now = Date.parse("2026-09-03T10:00:00.000Z");
  const m = (status: string, ends_at: string) => ({ status, ends_at });

  it("is the earliest end still ahead among the scheduled meetings", () => {
    expect(
      nextMissedAt(
        [
          m("SCHEDULED", "2026-09-03T12:00:00.000Z"),
          m("SCHEDULED", "2026-09-03T10:30:00.000Z"),
          m("SCHEDULED", "2026-09-03T09:00:00.000Z"),
          m("IN_PROGRESS", "2026-09-03T10:05:00.000Z"),
        ],
        now,
      ),
    ).toBe(Date.parse("2026-09-03T10:30:00.000Z"));
  });

  it("counts a meeting ending this very millisecond as still ahead, as displayMeetingStatus does", () => {
    expect(nextMissedAt([m("SCHEDULED", "2026-09-03T10:00:00.000Z")], now)).toBe(now);
  });

  it("is null when no scheduled meeting can still turn missed", () => {
    expect(nextMissedAt([m("ENDED", "2026-09-03T12:00:00.000Z"), m("SCHEDULED", "garbage")], now)).toBeNull();
    expect(nextMissedAt([], now)).toBeNull();
  });
});
