import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { VoiceCallLogRow } from "./voice-call-log-row";

beforeAll(() => {
  initI18n();
});

function voiceMessage(outcome: string, callerId = "peer"): ChatMessage {
  return {
    id: "m1",
    sender: callerId,
    body: "",
    ts: Date.now(),
    reactions: {},
    voiceCall: { outcome, duration_seconds: 125, caller_id: callerId },
  };
}

describe("VoiceCallLogRow", () => {
  it("shows completed call duration for participants", () => {
    render(
      wrap(<VoiceCallLogRow message={voiceMessage("completed")} currentUserId="me" />),
    );
    expect(screen.getByText(/Cuộc gọi thoại · 2:05/)).toBeInTheDocument();
  });

  it("shows missed label for unanswered incoming calls", () => {
    render(
      wrap(
        <VoiceCallLogRow message={voiceMessage("unanswered", "peer")} currentUserId="me" />,
      ),
    );
    expect(screen.getByText("Cuộc gọi nhỡ")).toBeInTheDocument();
  });

  it("shows cancelled label for unanswered outgoing calls", () => {
    render(
      wrap(
        <VoiceCallLogRow message={voiceMessage("unanswered", "me")} currentUserId="me" />,
      ),
    );
    expect(screen.getByText("Đã hủy cuộc gọi")).toBeInTheDocument();
  });
});
