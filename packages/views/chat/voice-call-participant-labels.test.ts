import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat-messages";
import { formatVoiceCallParticipantLabels } from "./voice-call-participant-labels";

function message(
  participants: NonNullable<ChatMessage["voiceCall"]>["participants"],
): ChatMessage {
  return {
    id: "m1",
    sender: "a",
    body: "",
    ts: 0,
    reactions: {},
    voiceCall: {
      outcome: "completed",
      caller_id: "a",
      participants,
    },
  };
}

describe("formatVoiceCallParticipantLabels", () => {
  it("returns empty string when participants are missing", () => {
    expect(formatVoiceCallParticipantLabels(message(undefined), "me", "Bạn")).toBe("");
  });

  it("labels the current user as you and joins names", () => {
    expect(
      formatVoiceCallParticipantLabels(
        message([
          { user_id: "a", display_name: "Alice" },
          { user_id: "me", display_name: "Me" },
        ]),
        "me",
        "Bạn",
      ),
    ).toBe("Alice, Bạn");
  });
});
