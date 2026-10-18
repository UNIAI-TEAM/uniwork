import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByText(/^Cuộc gọi · 2:05/)).toBeInTheDocument();
  });

  it("labels a camera call as video", () => {
    render(
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            ...voiceMessage("completed"),
            voiceCall: { outcome: "completed", duration_seconds: 125, caller_id: "peer", video: true },
          }}
          currentUserId="me"
        />,
      ),
    );
    expect(screen.getByText(/^Cuộc gọi video · 2:05/)).toBeInTheDocument();
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
    // Two people: the duration alone; who was on it stays one hover away.
    expect(screen.getByText("Cuộc gọi · 2:05")).toHaveAttribute("title", "Alice, Bạn");
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

  it("counts the people on a group call and names them on hover", () => {
    render(
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            ...voiceMessage("completed", "peer"),
            voiceCall: {
              outcome: "completed",
              duration_seconds: 1080,
              caller_id: "peer",
              participants: [
                { user_id: "peer", display_name: "Alice" },
                { user_id: "me", display_name: "Me" },
                { user_id: "u3", display_name: "Bình" },
              ],
            },
          }}
          currentUserId="me"
        />,
      ),
    );
    expect(screen.getByText("Cuộc gọi · 18:00 · 3 người")).toHaveAttribute("title", "Alice, Bạn, Bình");
  });

  it("offers the UNI summary of the call when there is one", () => {
    const onViewSummary = vi.fn();
    render(
      wrap(
        <VoiceCallLogRow
          workspaceId="ws1"
          roomId="room1"
          message={voiceMessage("completed")}
          currentUserId="me"
          onViewSummary={onViewSummary}
        />,
      ),
    );
    screen.getByRole("button", { name: "Xem tóm tắt" }).click();
    expect(onViewSummary).toHaveBeenCalled();
  });
});
