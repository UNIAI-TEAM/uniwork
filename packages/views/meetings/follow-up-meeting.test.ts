import { describe, expect, it } from "vitest";
import type { MeetingParticipant } from "@uniwork/core/types/meeting";
import { splitIsoLocal } from "./meeting-datetime";
import { followUpAttendeeIds, followUpScheduleDraft } from "./follow-up-meeting";

describe("followUpScheduleDraft", () => {
  const meeting = { starts_at: "2026-10-19T02:00:00Z", ends_at: "2026-10-19T02:45:00Z" };

  it("keeps the weekday, the time and the length, a week on", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    const from = splitIsoLocal("2026-10-26T02:00:00Z");
    expect(followUpScheduleDraft(meeting, now)).toEqual({ date: from.date, start: from.time, end: splitIsoLocal("2026-10-26T02:45:00Z").time });
  });

  it("skips the weeks already past", () => {
    const now = Date.parse("2026-11-03T00:00:00Z");
    expect(followUpScheduleDraft(meeting, now)?.date).toBe(splitIsoLocal("2026-11-09T02:00:00Z").date);
  });

  it("leaves the form's own default for a window it cannot read", () => {
    expect(followUpScheduleDraft({ starts_at: "x", ends_at: "y" })).toBeUndefined();
  });
});

describe("followUpAttendeeIds", () => {
  const p = (over: Partial<MeetingParticipant>): MeetingParticipant =>
    ({ id: "p", meeting_id: "m", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE", ...over }) as MeetingParticipant;

  it("invites the people still in the meeting again, once, without the host or a guest", () => {
    const ids = followUpAttendeeIds(
      [p({ user_id: "u-host" }), p({ user_id: "u1" }), p({ user_id: "u1" }), p({ user_id: "u2", status: "REMOVED" }), p({ principal_type: "GUEST", guest_id: "g" })],
      "u-host",
    );
    expect(ids).toEqual(["u1"]);
  });
});
