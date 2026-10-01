import { describe, expect, it } from "vitest";
import { canClerkMeeting } from "../permissions/rules";
import type { PermissionContext } from "../permissions/types";
import type { MeetingParticipant } from "../types/meeting";

const p = (over: Partial<MeetingParticipant>): MeetingParticipant => ({
  id: "p", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE", ...over,
});
const ctx = (userId: string, wsRole: PermissionContext["wsRole"] = "member"): PermissionContext => ({
  userId,
  orgRole: null,
  wsRole,
});

describe("canClerkMeeting — mirrors MeetingService.requireMeetingClerk", () => {
  const meeting = { host_user_id: "host" };

  it("allows the host and workspace admins", () => {
    expect(canClerkMeeting(meeting, [], ctx("host")).allowed).toBe(true);
    expect(canClerkMeeting(meeting, [], ctx("x", "admin")).allowed).toBe(true);
  });

  it("allows an active signed-in secretary only", () => {
    const sec = p({ user_id: "u1", is_secretary: true });
    expect(canClerkMeeting(meeting, [sec], ctx("u1")).allowed).toBe(true);
    expect(canClerkMeeting(meeting, [{ ...sec, status: "REMOVED" }], ctx("u1")).allowed).toBe(false);
    expect(canClerkMeeting(meeting, [{ ...sec, is_secretary: false }], ctx("u1")).allowed).toBe(false);
    expect(canClerkMeeting(meeting, [sec], ctx("u2")).allowed).toBe(false);
  });

  it("refuses without a workspace role", () => {
    expect(canClerkMeeting(meeting, [p({ user_id: "u1", is_secretary: true })], ctx("u1", null)).allowed).toBe(false);
  });

  it("words the refusal for attendance and votes alike", () => {
    expect(canClerkMeeting(meeting, [], ctx("u2")).message).toBe(
      "Only the host, a secretary or a workspace admin can run attendance and votes.",
    );
  });
});
