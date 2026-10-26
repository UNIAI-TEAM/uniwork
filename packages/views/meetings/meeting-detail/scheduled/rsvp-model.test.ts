import { describe, expect, it } from "vitest";
import { myInvitation, rsvpCounts, rsvpState } from "./rsvp-model";

const participants = [
  { id: "p-lan", user_id: "lan", display_name_snapshot: "Lan Phạm" },
  { id: "p-ha", user_id: "ha", display_name_snapshot: "Hà Vũ" },
  { id: "p-minh", user_id: "minh", display_name_snapshot: "Minh Trần" },
];
const invitations = [
  { id: "i-ha", participant_id: "p-ha", response_status: "ACCEPTED" },
  { id: "i-minh", participant_id: "p-minh", response_status: "PENDING" },
  { id: "i-gone", participant_id: "p-gone", response_status: "DECLINED" },
];

describe("rsvp-model", () => {
  it("reads anything but the three answers as not answered yet", () => {
    expect(rsvpState("TENTATIVE")).toBe("TENTATIVE");
    expect(rsvpState("PENDING")).toBe("PENDING");
    expect(rsvpState("SOMETHING_NEWER")).toBe("PENDING");
    expect(rsvpState(undefined)).toBe("PENDING");
  });

  it("finds the viewer's own invitation through their participant row", () => {
    expect(myInvitation(participants, invitations, "minh")?.id).toBe("i-minh");
    expect(myInvitation(participants, invitations, "lan")).toBeUndefined();
    expect(myInvitation(participants, invitations, "tuan")).toBeUndefined();
  });

  it("counts the answers of active participants and names who has not answered", () => {
    expect(rsvpCounts(participants, invitations)).toEqual({
      ACCEPTED: 1,
      TENTATIVE: 0,
      DECLINED: 0,
      PENDING: 1,
      pendingNames: ["Minh Trần"],
    });
  });
});
