import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatVoiceMessageRow } from "./chat-voice-message-row";

initI18n();

describe("ChatVoiceMessageRow", () => {
  it("renders localized playback control and duration", () => {
    render(
      wrap(
        <ChatVoiceMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message1",
            sender: "user1",
            body: "",
            kind: "voice",
            ts: Date.now(),
            reactions: {},
            voice: {
              duration_ms: 12_400,
              content_type: "audio/webm",
              size_bytes: 2048,
            },
          }}
          senderLabel="An"
          isOwn
          showSenderName={false}
          compactTop={false}
          showAvatar={false}
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "Phát tin nhắn thoại" })).toBeInTheDocument();
    expect(screen.getByText("Tin nhắn thoại")).toBeInTheDocument();
    expect(screen.getByText("0:13")).toBeInTheDocument();
  });

  it("carries the highlight ring when a deep link jumped to it", () => {
    const { container } = render(
      wrap(
        <ChatVoiceMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message-hl",
            sender: "user1",
            body: "",
            kind: "voice",
            ts: Date.now(),
            reactions: {},
            voice: { duration_ms: 1000, content_type: "audio/webm", size_bytes: 10 },
          }}
          senderLabel="An"
          isOwn
          showSenderName={false}
          compactTop={false}
          showAvatar={false}
          highlighted
        />,
      ),
    );
    expect(container.querySelector("#chat-msg-message-hl")).toHaveClass("before:bg-brand-subtle", "before:ring-1", "before:ring-brand/25");
  });
});
