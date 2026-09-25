import { describe, expect, it } from "vitest";
import { isMultiPartyVoiceCall, voiceCallKindFromServer } from "./voice-call-kind-utils";

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
});
