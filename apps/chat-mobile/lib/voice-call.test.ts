// voice-call-copy.ts' ended lines, for the reasons a phone call can end with.
import { describe, expect, it } from "vitest";
import { VOICE_CALL_HANDLED_CODES, voiceCallEndedMessage } from "./voice-call";

describe("voiceCallEndedMessage", () => {
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
    // The codes crash reporting leaves out are exactly the ones said in words.
    for (const code of VOICE_CALL_HANDLED_CODES) expect(ended("start_failed", { body: { error: { code } } })).not.toBe("chat.voice_call_failed");
    expect(ended("peer_ended")).toBe("chat.voice_call_ended_peer_ended");
    expect(ended("alone")).toBe("chat.voice_call_ended_peer_ended");
  });
});
