import { describe, expect, it } from "vitest";
import { incomingStateFromInvite, latestRingingInvite, voiceEventForUser } from "./voice-call-invites";

describe("voice-call-invites", () => {
  const allowed = new Set(["room-dm", "room-group"]);

  it("hears a frame aimed at this person, or one for a room they are in", () => {
    expect(voiceEventForUser({ room_id: "room-dm", target_user_id: "me" }, "me", allowed)).toBe(true);
    expect(voiceEventForUser({ room_id: "room-dm", target_user_id: "peer" }, "me", allowed)).toBe(false);
    expect(voiceEventForUser({ room_id: "room-group", call_kind: "group" }, "me", allowed)).toBe(true);
    expect(voiceEventForUser({ room_id: "elsewhere", call_kind: "channel" }, "me", allowed)).toBe(false);
    expect(voiceEventForUser({ call_kind: "dm" }, "me", allowed)).toBe(false);
    // A frame without a target falls back to the rooms this person is in.
    expect(voiceEventForUser({ room_id: "room-dm" }, "me", allowed)).toBe(true);
  });

  it("falls back to the caller's id when no name came with the invite", () => {
    expect(incomingStateFromInvite({ room_id: "r", call_id: "c", caller_id: "u", call_kind: "group" })).toMatchObject({ peerName: "u", callerName: "u", callerId: "u" });
    expect(incomingStateFromInvite({ room_id: "r", call_id: "c", caller_id: "u", caller_name: " " })).toMatchObject({ peerName: "u" });
  });

  it("names a 1-1 call after the caller and a group call after the room", () => {
    expect(incomingStateFromInvite({ room_id: "r", call_id: "c", caller_id: "u", caller_name: " Long ", call_kind: "dm" })).toEqual({
      status: "incoming",
      callId: "c",
      roomId: "r",
      peerName: "Long",
      callKind: "dm",
      callerName: undefined,
      callerId: undefined,
    });
    expect(incomingStateFromInvite({ room_id: "r", call_id: "c", caller_id: "u", caller_name: "Long", call_kind: "group", room_name: "Đội" })).toMatchObject({
      peerName: "Đội",
      callKind: "group",
      callerName: "Long",
    });
    expect(incomingStateFromInvite({ room_id: "r", call_id: "c" })).toBeNull();
  });

  it("does not resurrect an invite that already rang out, rings for a fresh one", () => {
    const now = Date.parse("2026-10-17T10:00:00Z");
    const invite = (callId: string, ageMs: number) => ({
      room_id: "room-dm",
      call_id: callId,
      caller_id: "peer",
      caller_name: "Long",
      call_kind: "dm",
      invited_at: new Date(now - ageMs).toISOString(),
    });
    expect(latestRingingInvite([invite("stale", 2 * 60_000)], now)).toBeNull();
    expect(latestRingingInvite([invite("older", 20_000), invite("fresh", 5_000), invite("stale", 2 * 60_000)], now)?.call_id).toBe("fresh");
    expect(latestRingingInvite([invite("fresh", 5_000), invite("older", 20_000)], now)?.call_id).toBe("fresh");
    expect(latestRingingInvite([{ ...invite("x", 0), invited_at: "" }], now)).toBeNull();
  });
});
