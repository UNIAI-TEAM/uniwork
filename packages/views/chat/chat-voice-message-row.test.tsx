import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { ChatVoiceMessageRow } from "./chat-voice-message-row";
import type { ChatMessage } from "./chat-messages";

initI18n();

const voiceMessage: ChatMessage = {
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
};

function renderRow(message: ChatMessage = voiceMessage) {
  return render(
    wrap(
      <ChatVoiceMessageRow
        workspaceId="ws1"
        roomId="room1"
        message={message}
        senderLabel="An"
        isOwn
        showSenderName={false}
        compactTop={false}
        showAvatar={false}
      />,
    ),
  );
}

/** Serves the AI capabilities and the transcript route; anything else answers empty. */
function serveAi(enabled: boolean, transcript: () => Promise<unknown>) {
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/ai/capabilities")) return Promise.resolve({ enabled, ask_uni: enabled });
    if (path.endsWith("/chat/messages/message1/transcript")) return transcript();
    return Promise.resolve({});
  });
}

afterEach(() => requestMock.mockReset());

describe("ChatVoiceMessageRow", () => {
  it("renders localized playback control and duration", () => {
    renderRow();

    expect(screen.getByRole("button", { name: "Phát tin nhắn thoại" })).toBeInTheDocument();
    expect(screen.getByText("Tin nhắn thoại")).toBeInTheDocument();
    expect(screen.getByText("0:13")).toBeInTheDocument();
  });

  it("has no transcript chip while AI is off", async () => {
    serveAi(false, () => Promise.resolve({ text: "x" }));
    renderRow();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Xem bản chép" })).not.toBeInTheDocument();
  });

  it("asks for the transcript once, then shows and hides it", async () => {
    serveAi(true, () => Promise.resolve({ text: "Chốt lịch thứ Năm nhé.", language: "vietnamese" }));
    renderRow();
    const chip = await screen.findByRole("button", { name: "Xem bản chép" });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(chip);
    expect(await screen.findByText("Chốt lịch thứ Năm nhé.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ẩn bản chép" }));
    expect(screen.queryByText("Chốt lịch thứ Năm nhé.")).not.toBeInTheDocument();
    // Opening it again reads the cache: the text never changes once made.
    await userEvent.click(screen.getByRole("button", { name: "Xem bản chép" }));
    expect(screen.getByText("Chốt lịch thứ Năm nhé.")).toBeInTheDocument();
    const asks = requestMock.mock.calls.filter(([path]) => String(path).endsWith("/transcript"));
    expect(asks).toHaveLength(1);
    expect(asks[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("names the refusal and retries on request", async () => {
    let calls = 0;
    serveAi(true, () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new ApiError("x", "cloud_unavailable", 503))
        : Promise.resolve({ text: "Được rồi.", language: "" });
    });
    renderRow();
    await userEvent.click(await screen.findByRole("button", { name: "Xem bản chép" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Máy chủ chưa cấu hình dịch vụ chép lời.");
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Được rồi.")).toBeInTheDocument();
  });

  it("keeps showing Đang chép while another reader's transcription runs, then the text", async () => {
    let calls = 0;
    serveAi(true, () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new ApiError("x", "chat_transcript_pending", 409))
        : Promise.resolve({ text: "Xong rồi.", language: "" });
    });
    renderRow();
    await userEvent.click(await screen.findByRole("button", { name: "Xem bản chép" }));
    expect(await screen.findByRole("button", { name: "Đang chép…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The hook asks again after a second, without the reader doing anything.
    expect(await screen.findByText("Xong rồi.", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("offers no transcript for a note still sending", async () => {
    serveAi(true, () => Promise.resolve({ text: "x" }));
    renderRow({ ...voiceMessage, deliveryStatus: "sending" });
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Xem bản chép" })).not.toBeInTheDocument();
  });
});
