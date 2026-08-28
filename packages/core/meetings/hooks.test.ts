import { describe, expect, it } from "vitest";
import {
  activityLabelKey,
  inviteLinkStatus,
  isJoinAdmitted,
  meetingKeys,
  splitMeetings,
} from "./hooks";
import type { Meeting, MeetingInviteLink } from "../types";

const mk = (id: string, starts: string, ends: string): Meeting => ({
  id,
  workspace_id: "w",
  title: id,
  description: "",
  starts_at: starts,
  ends_at: ends,
  room_name: `uniwork-${id}`,
  created_by: "u",
});

describe("splitMeetings", () => {
  it("splits by ends_at and sorts each side", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const a = mk("a", "2026-08-24T13:00:00Z", "2026-08-24T14:00:00Z"); // upcoming
    const b = mk("b", "2026-08-25T09:00:00Z", "2026-08-25T10:00:00Z"); // upcoming, sau a
    const c = mk("c", "2026-08-20T09:00:00Z", "2026-08-20T10:00:00Z"); // past
    const d = mk("d", "2026-08-23T09:00:00Z", "2026-08-23T10:00:00Z"); // past, mới hơn c
    const { upcoming, past } = splitMeetings([d, b, c, a], now);
    expect(upcoming.map((m) => m.id)).toEqual(["a", "b"]);
    expect(past.map((m) => m.id)).toEqual(["d", "c"]);
  });

  it("treats ENDED and CANCELED as past even if ends_at is in the future", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const ended = { ...mk("e", "2026-08-24T13:00:00Z", "2026-08-24T14:00:00Z"), status: "ENDED" };
    const { upcoming, past } = splitMeetings([ended], now);
    expect(upcoming).toEqual([]);
    expect(past.map((m) => m.id)).toEqual(["e"]);
  });
});

describe("admission and invite-link helpers", () => {
  it("admits only when decision, token and url are all present", () => {
    expect(isJoinAdmitted({ decision: "ADMIT", participant_token: "t", server_url: "wss://lk" })).toBe(true);
    expect(isJoinAdmitted({ decision: "ADMIT", participant_token: "t" })).toBe(false);
    expect(isJoinAdmitted({ decision: "WAITING_FOR_HOST", participant_token: "t", server_url: "wss://lk" })).toBe(false);
  });

  it("derives invite-link UI status without exposing a secret", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    const base: MeetingInviteLink = {
      id: "l1", meeting_id: "m1", name: "guest", access_mode: "AUTO_ADMIT",
      expires_at: "2026-08-29T00:00:00Z", used_count: 0,
    };
    expect(inviteLinkStatus(base, now)).toBe("active");
    expect(inviteLinkStatus({ ...base, revoked_at: "2026-08-28T11:00:00Z" }, now)).toBe("revoked");
    expect(inviteLinkStatus({ ...base, expires_at: "2026-08-28T00:00:00Z" }, now)).toBe("expired");
    expect(inviteLinkStatus({ ...base, max_uses: 2, used_count: 2 }, now)).toBe("limit_reached");
  });

  it("maps known audit events to i18n keys and falls back", () => {
    expect(activityLabelKey("MEETING_STARTED")).toBe("meetings.activity_started");
    expect(activityLabelKey("UNKNOWN_EVT")).toBe("meetings.activity_generic");
  });
});

describe("meetingKeys.joinRequests", () => {
  it("nests under a prefix so reconnect can refresh every observed list", () => {
    expect(meetingKeys.joinRequests("m1")).toEqual(["meeting-join-requests", "m1"]);
    expect(meetingKeys.joinRequestsRoot).toEqual(["meeting-join-requests"]);
  });
});
