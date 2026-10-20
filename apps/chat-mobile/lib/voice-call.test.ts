// Parity with packages/views/chat/voice-call-kind-utils.test.ts and the
// invite cases of use-native-voice-call.test.tsx (rings out, still fresh).
import { describe, expect, it } from "vitest";
import {
  incomingStateFromInvite,
  isInformationalEnd,
  isMultiPartyVoiceCall,
  latestRingingInvite,
  voiceCallEndedMessage,
  voiceCallKindFromServer,
  voiceEventForUser,
} from "./voice-call";

describe("voice-call-kind-utils parity", () => {
  it("treats channel like group for multi-party checks", () => {
    expect(isMultiPartyVoiceCall("channel")).toBe(true);
    expect(isMultiPartyVoiceCall("group")).toBe(true);
    expect(isMultiPartyVoiceCall("dm")).toBe(false);
  });

  it("maps server call_kind to VoiceCallKind", () => {
    expect(voiceCallKindFromServer("channel")).toBe("channel");
    expect(voiceCallKindFromServer("group")).toBe("group");
    expect(voiceCallKindFromServer(undefined)).toBe("dm");
  });
});

describe("voice-call-invites parity", () => {
  const allowed = new Set(["room-dm", "room-group"]);

  it("hears a 1-1 frame meant for this user only, a group frame for a room they are in", () => {
    expect(voiceEventForUser({ room_id: "room-dm", target_user_id: "me", call_kind: "dm" }, "me", allowed)).toBe(true);
    expect(voiceEventForUser({ room_id: "room-dm", target_user_id: "peer", call_kind: "dm" }, "me", allowed)).toBe(false);
    expect(voiceEventForUser({ room_id: "room-group", call_kind: "group" }, "me", allowed)).toBe(true);
    expect(voiceEventForUser({ room_id: "elsewhere", call_kind: "channel" }, "me", allowed)).toBe(false);
    expect(voiceEventForUser({ call_kind: "dm" }, "me", allowed)).toBe(false);
    // A 1-1 frame without a target falls back to the rooms this person is in.
    expect(voiceEventForUser({ room_id: "room-dm", call_kind: "dm" }, "me", allowed)).toBe(true);
  });

  it("falls back to the caller's id when no name came with the invite", () => {
    expect(incomingStateFromInvite({ room_id: "r", call_id: "c", caller_id: "u", call_kind: "group" })).toMatchObject({ peerName: "u", callerName: "u" });
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

  it("says why a call ended in the web's words (voice-call-copy.ts)", () => {
    const t = (key: string) => key;
    const ended = (reason: Parameters<typeof voiceCallEndedMessage>[0]["reason"], error?: unknown) =>
      voiceCallEndedMessage({ status: "ended", reason, error, roomId: "r", peerName: "Long", callKind: "dm", outgoing: true }, t);
    expect(ended("no_answer")).toBe("chat.voice_call_ended_no_answer");
    expect(ended("missed")).toBe("chat.voice_call_ended_missed");
    expect(ended("declined")).toBe("chat.voice_call_log_declined_outgoing");
    expect(ended("connect_failed")).toBe("chat.voice_call_connect_failed");
    expect(ended("start_failed", new Error("x"))).toBe("chat.voice_call_failed");
    expect(ended("start_failed", { body: { error: { code: "livekit_not_configured" } } })).toBe("chat.voice_call_not_configured");
    expect(ended("start_failed", { body: { error: { code: "chat_user_blocked" } } })).toBe("chat.voice_call_blocked");
    expect(ended("peer_ended")).toBe("chat.voice_call_ended_peer_ended");
    expect(ended("alone")).toBe("chat.voice_call_ended_peer_ended");
  });

  it("clears an informational end on its own and keeps a failure up", () => {
    expect(isInformationalEnd("peer_ended")).toBe(true);
    expect(isInformationalEnd("declined")).toBe(true);
    expect(isInformationalEnd("connect_failed")).toBe(false);
    expect(isInformationalEnd("missed")).toBe(false);
  });
});
