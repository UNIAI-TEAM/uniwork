import { describe, expect, it } from "vitest";
import type { MeetingParticipant } from "@uniwork/core/types/meeting";
import { followUpAttendeeIds, followUpWindow } from "./follow-up-draft";

// Ported from follow-up-meeting.test.ts when the follow-up rules moved into the sheet.
describe("followUpWindow", () => {
  const meeting = { starts_at: "2026-10-19T02:00:00Z", ends_at: "2026-10-19T02:45:00Z" };
  const HCM = "Asia/Ho_Chi_Minh";

  it("keeps the weekday, the time and the length, a week on", () => {
    expect(followUpWindow(meeting, Date.parse("2026-10-20T00:00:00Z"), HCM)).toEqual({ date: "2026-10-26", start: "09:00", end: "09:45" });
  });

  it("skips the weeks already past", () => {
    expect(followUpWindow(meeting, Date.parse("2026-11-03T00:00:00Z"), HCM)?.date).toBe("2026-11-09");
  });

  it("keeps the wall time across a DST change", () => {
    // Thu 22 Oct 2026 09:00 BST; the EU clocks go back on 25 Oct.
    const london = { starts_at: "2026-10-22T08:00:00Z", ends_at: "2026-10-22T08:28:00Z" };
    expect(followUpWindow(london, Date.parse("2026-10-25T12:00:00Z"), "Europe/London")).toEqual({ date: "2026-10-29", start: "09:00", end: "09:30" });
    // Thu 29 Oct 09:00 GMT is 09:00Z: half past eight UTC is still before it.
    expect(followUpWindow(london, Date.parse("2026-10-29T08:30:00Z"), "Europe/London")?.date).toBe("2026-10-29");
    // Thu 29 Oct 2026 09:00 PDT; the US clocks go back on 1 Nov.
    const la = { starts_at: "2026-10-29T16:00:00Z", ends_at: "2026-10-29T17:00:00Z" };
    expect(followUpWindow(la, Date.parse("2026-11-02T00:00:00Z"), "America/Los_Angeles")).toEqual({ date: "2026-11-05", start: "09:00", end: "10:00" });
  });

  it("leaves the form's own default for a window it cannot read", () => {
    expect(followUpWindow({ starts_at: "x", ends_at: "y" }, 0, HCM)).toBeUndefined();
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
