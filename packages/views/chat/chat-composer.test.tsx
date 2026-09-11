import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatComposer } from "./chat-composer";

initI18n();

vi.mock("@uniwork/core/chat", () => ({
  useChatGifs: () => ({ data: [], isFetching: false }),
  useChatStickers: () => ({ data: [], isFetching: false }),
}));

vi.mock("./chat-sticker-packs", () => ({
  loadChatStickerPacks: vi.fn().mockResolvedValue([]),
  filterStickerPacks: (packs: unknown[]) => packs,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

describe("ChatComposer", () => {
  it("renders composer toolbar and opens attach menu", async () => {
    const onDraftChange = vi.fn();
    const onSend = vi.fn();

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={onDraftChange}
          onSend={onSend}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );

    expect(screen.getByLabelText("Đính kèm")).toBeInTheDocument();
    expect(screen.getByLabelText("Tin nhắn thoại")).toBeInTheDocument();
    expect(screen.queryByLabelText("Thêm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Đính kèm"));
    expect(await screen.findByRole("menuitem", { name: "Tạo bình chọn" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Tạo nhắc hẹn" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Đính kèm tệp" })).toBeInTheDocument();
  });

  it("hides create poll in dm conversations", async () => {
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
          showCreatePoll={false}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Đính kèm"));
    expect(await screen.findByRole("menuitem", { name: "Tạo nhắc hẹn" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Tạo bình chọn" })).not.toBeInTheDocument();
  });

  it("submits on Enter and shows send when draft has text", () => {
    const onSend = vi.fn();

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft="hello"
          onDraftChange={vi.fn()}
          onSend={onSend}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "Gửi" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Nhập tin nhắn…"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("ignores the Enter that only commits an IME composition", () => {
    const onSend = vi.fn();

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft="xin chào"
          onDraftChange={vi.fn()}
          onSend={onSend}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );

    const textarea = screen.getByLabelText("Nhập tin nhắn…");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("shows priority chip and clears it", () => {
    const onSend = vi.fn();
    const onPriorityChange = vi.fn();

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft="hello"
          onDraftChange={vi.fn()}
          onSend={onSend}
          composerPriority="urgent"
          onComposerPriorityChange={onPriorityChange}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );

    expect(screen.getByText("Khẩn cấp")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Bỏ đánh dấu"));
    expect(onPriorityChange).toHaveBeenCalledWith(null);
  });

  it("starts voice recording on click and shows cancel and send", async () => {
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: stopTrack }],
        }),
      },
    });
    class Recorder {
      static isTypeSupported = () => true;
      state: RecordingState = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", Recorder);

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          onSendVoice={vi.fn()}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Tin nhắn thoại"));
    expect(await screen.findByRole("button", { name: "Hủy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("pastes an accepted image into onSendFile", () => {
    const onSendFile = vi.fn();
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          onSendFile={onSendFile}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );

    const file = new File(["png"], "shot.png", { type: "image/png" });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [file] },
    });
    expect(onSendFile).toHaveBeenCalledWith(file);
  });

  it("rejects unsupported paste types", () => {
    const onSendFile = vi.fn();
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          onSendFile={onSendFile}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );

    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: {
        files: [new File(["x"], "virus.exe", { type: "application/octet-stream" })],
      },
    });
    expect(onSendFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
