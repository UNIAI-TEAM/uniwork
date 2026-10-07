import { describe, expect, it } from "vitest";
import {
  isMultiPartyVoiceCall,
  voiceCallKindFromServer,
  voiceCallPrimaryLeaveEndsForAll,
} from "./voice-call-kind-utils";

describe("voice-call-kind-utils", () => {
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

  it("caller hang-up on channel/group signals server hangup even with peers in room", () => {
    expect(voiceCallPrimaryLeaveEndsForAll("channel", true)).toBe(true);
    expect(voiceCallPrimaryLeaveEndsForAll("group", true)).toBe(true);
    expect(voiceCallPrimaryLeaveEndsForAll("channel", false)).toBe(false);
    expect(voiceCallPrimaryLeaveEndsForAll("dm", false)).toBe(true);
  });
});
