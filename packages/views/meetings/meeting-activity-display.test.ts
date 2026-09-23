import { describe, expect, it } from "vitest";
import type { MeetingActivityItem } from "@uniwork/core/types/meeting";
import { activityKind, activityLabel, activityStateChange, visibleActivity } from "./meeting-activity-display";

const item = (over: Partial<MeetingActivityItem>): MeetingActivityItem => ({
  id: "a",
  event_type: "MEETING_STARTED",
  actor_id: "u1",
  occurred_at: "2026-09-22T02:00:00Z",
  ...over,
});

describe("meeting activity display", () => {
  it("drops provider and conference-session bookkeeping", () => {
    const shown = visibleActivity([
      item({ id: "1", event_type: "PROVIDER_ROOM_IDLE_DESYNC" }),
      item({ id: "2", event_type: "CONFERENCE_SESSION_CREATED" }),
      item({ id: "3", event_type: "CONFERENCE_SESSION_ENDED" }),
      item({ id: "4", event_type: "MEETING_STARTED" }),
    ]);
    expect(shown.map((i) => i.id)).toEqual(["4"]);
  });

  it("returns a meeting state change only between two known, different states", () => {
    expect(activityStateChange(item({ from_state: "SCHEDULED", to_state: "IN_PROGRESS" }))).toEqual({
      fromKey: "meetings.status_SCHEDULED",
      toKey: "meetings.status_IN_PROGRESS",
    });
    expect(activityStateChange(item({ event_type: "MEETING_UPDATED", from_state: "IN_PROGRESS", to_state: "IN_PROGRESS" }))).toBeNull();
    expect(activityStateChange(item({ event_type: "PARTICIPANT_INVITED", to_state: "01J8X4K2M0N1P2Q3R4S5T6U7V8" }))).toBeNull();
    expect(activityStateChange(item({ event_type: "JOIN_REQUEST_APPROVED", from_state: "PENDING", to_state: "APPROVED" }))).toBeNull();
  });

  it("translates an RSVP change with the RSVP words", () => {
    expect(activityStateChange(item({ event_type: "INVITATION_RESPONDED", from_state: "PENDING", to_state: "ACCEPTED" }))).toEqual({
      fromKey: "meetings.rsvp_PENDING",
      toKey: "meetings.rsvp_ACCEPTED",
    });
  });

  it("groups events into kinds for the rail icon and names the AI ones", () => {
    expect(activityKind("MEETING_STARTED")).toBe("started");
    expect(activityKind("MEETING_CANCELED")).toBe("canceled");
    expect(activityKind("SUMMARY_CREATED")).toBe("ai");
    expect(activityKind("JOIN_REQUEST_APPROVED")).toBe("join");
    expect(activityKind("SOMETHING_NEW")).toBe("other");
    expect(activityLabel("SUMMARY_CREATED")).toBe("meetings.activity_summary_created");
    expect(activityLabel("MEETING_STARTED")).toBe("meetings.activity_started");
    expect(activityLabel("SOMETHING_NEW")).toBe("meetings.activity_generic");
  });
});
