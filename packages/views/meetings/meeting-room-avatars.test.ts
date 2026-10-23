import { describe, expect, it } from "vitest";
import type { MeetingParticipant } from "@uniwork/core/types";
import { roomAvatarIndex } from "./meeting-room-avatars";

function participant(id: string, userId?: string): MeetingParticipant {
  return {
    id,
    meeting_id: "m1",
    principal_type: userId ? "USER" : "GUEST",
    user_id: userId,
    role: "PARTICIPANT",
    status: "ACTIVE",
  };
}

describe("roomAvatarIndex", () => {
  const photos: Record<string, unknown> = { u1: "https://cdn/u1.png", u2: "  ", u3: null };
  const avatarOf = roomAvatarIndex(
    [participant("p1", "u1"), participant("p2", "u2"), participant("p3", "u3"), participant("g1")],
    (userId) => photos[userId],
  );

  it("maps a LiveKit identity to its member's photo", () => {
    expect(avatarOf("uw_participant_p1")).toBe("https://cdn/u1.png");
  });

  it("leaves members without a photo, guests and unknown identities on initials", () => {
    expect(avatarOf("uw_participant_p2")).toBeUndefined();
    expect(avatarOf("uw_participant_p3")).toBeUndefined();
    expect(avatarOf("uw_participant_g1")).toBeUndefined();
    expect(avatarOf("p1")).toBeUndefined();
    expect(avatarOf(undefined)).toBeUndefined();
  });
});
