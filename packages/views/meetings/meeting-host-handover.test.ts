import { describe, expect, it } from "vitest";
import type { MeetingParticipant } from "@uniwork/core/types";
import { handoverCandidates, hostInRoom } from "./meeting-host-handover";

const collator = new Intl.Collator("vi", { sensitivity: "base" });

function person(id: string, over: Partial<MeetingParticipant> = {}): MeetingParticipant {
  return {
    id,
    meeting_id: "m1",
    principal_type: "USER",
    user_id: `u-${id}`,
    display_name_snapshot: id,
    role: "ATTENDEE",
    status: "ACTIVE",
    ...over,
  };
}

const live = (...ids: string[]) => new Set(ids.map((id) => `uw_participant_${id}`));

describe("handoverCandidates", () => {
  it("offers workspace people in the room, the secretary first, then by name", () => {
    const rows = [
      person("host", { user_id: "u-host" }),
      person("Minh"),
      person("An"),
      person("Lan", { is_secretary: true }),
    ];
    const out = handoverCandidates(rows, live("host", "Minh", "An", "Lan"), "u-host", collator);
    expect(out.map((p) => p.id)).toEqual(["Lan", "An", "Minh"]);
  });

  it("leaves out guests, removed people, someone not in the room and the host", () => {
    const rows = [
      person("guest", { principal_type: "GUEST", user_id: undefined }),
      person("gone", { status: "REMOVED" }),
      person("away"),
      person("host", { user_id: "u-host" }),
      person("Ha"),
    ];
    const out = handoverCandidates(rows, live("guest", "gone", "host", "Ha"), "u-host", collator);
    expect(out.map((p) => p.id)).toEqual(["Ha"]);
  });

  it("lists a person once even with two seats", () => {
    const rows = [person("a", { user_id: "u-same" }), person("b", { user_id: "u-same" })];
    expect(handoverCandidates(rows, live("a", "b"), undefined, collator)).toHaveLength(1);
  });
});

describe("hostInRoom", () => {
  it("reads the host's seat from the room", () => {
    const rows = [person("host", { user_id: "u-host" }), person("Ha")];
    expect(hostInRoom(rows, live("host", "Ha"), "u-host")).toBe(true);
    expect(hostInRoom(rows, live("Ha"), "u-host")).toBe(false);
    expect(hostInRoom(rows, live("Ha"), undefined)).toBe(false);
  });
});
