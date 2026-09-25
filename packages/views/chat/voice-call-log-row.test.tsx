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
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={voiceMessage("completed")}
          currentUserId="me"
        />,
      ),
    );
    // The log does not know whether it was a video call, so it says "Cuộc gọi".
    expect(screen.getByText(/^Cuộc gọi · 2:05/)).toBeInTheDocument();
  });

  it("shows participant names on completed calls", () => {
    render(
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            ...voiceMessage("completed", "peer"),
            voiceCall: {
              outcome: "completed",
              duration_seconds: 125,
              caller_id: "peer",
              participants: [
                { user_id: "peer", display_name: "Alice" },
                { user_id: "me", display_name: "Me" },
              ],
            },
          }}
          currentUserId="me"
        />,
      ),
    );
    const label = screen.getByText(/Cuộc gọi · 2:05 · Alice, Bạn/);
    // A long list truncates; the full line stays available on hover.
    expect(label).toHaveAttribute("title", "Cuộc gọi · 2:05 · Alice, Bạn");
  });

  it("shows missed label for unanswered incoming calls", () => {
    render(
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={voiceMessage("unanswered", "peer")}
          currentUserId="me"
        />,
      ),
    );
    expect(screen.getByText("Cuộc gọi nhỡ")).toBeInTheDocument();
  });

  it("shows cancelled label for unanswered outgoing calls", () => {
    render(
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={voiceMessage("unanswered", "me")}
          currentUserId="me"
        />,
      ),
    );
    expect(screen.getByText("Đã hủy cuộc gọi")).toBeInTheDocument();
  });

  it("says the recording failed instead of showing nothing", () => {
    render(
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            ...voiceMessage("completed"),
            voiceCall: { outcome: "completed", duration_seconds: 60, caller_id: "peer", recording_status: "FAILED" },
          }}
          currentUserId="me"
        />,
      ),
    );
    expect(screen.getByText("Ghi âm thất bại")).toBeInTheDocument();
  });
});
