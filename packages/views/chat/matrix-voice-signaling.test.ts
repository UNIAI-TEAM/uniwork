import { describe, expect, it } from "vitest";
import { isDuplicateVoiceInvite, parseVoiceCallSignal } from "./matrix-voice-signaling";

describe("parseVoiceCallSignal", () => {
  it("accepts invite and hangup payloads", () => {
    expect(parseVoiceCallSignal({ call_id: "abc", action: "invite" })).toEqual({
      call_id: "abc",
      action: "invite",
    });
    expect(parseVoiceCallSignal({ call_id: "xyz", action: "hangup" })).toEqual({
      call_id: "xyz",
      action: "hangup",
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseVoiceCallSignal(null)).toBeNull();
    expect(parseVoiceCallSignal({ call_id: "", action: "invite" })).toBeNull();
    expect(parseVoiceCallSignal({ call_id: "a", action: "ring" })).toBeNull();
  });
});

describe("isDuplicateVoiceInvite", () => {
  it("detects duplicate invite for same call and room", () => {
    const payload = { callId: "c1", matrixRoomId: "!room:host" };
    expect(
      isDuplicateVoiceInvite(
        { status: "incoming", callId: "c1", matrixRoomId: "!room:host" },
        payload,
      ),
    ).toBe(true);
    expect(
      isDuplicateVoiceInvite(
        { status: "active", callId: "c1", matrixRoomId: "!room:host" },
        payload,
      ),
    ).toBe(true);
    expect(isDuplicateVoiceInvite({ status: "idle" }, payload)).toBe(false);
    expect(
      isDuplicateVoiceInvite(
        { status: "incoming", callId: "c2", matrixRoomId: "!room:host" },
        payload,
      ),
    ).toBe(false);
  });
});
