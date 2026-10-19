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
import { clipShape } from "./chat-composer-parts";
import { rmsLevel } from "./use-chat-voice-recorder";

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
    expect(screen.getByLabelText("Ghi âm tin nhắn thoại")).toBeInTheDocument();
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

    fireEvent.click(screen.getByLabelText("Ghi âm tin nhắn thoại"));
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
    // A pasted file waits in the composer until the message is sent.
    expect(onSendFile).not.toHaveBeenCalled();
    expect(screen.getByText("shot.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    expect(onSendFile).toHaveBeenCalledWith(file);
    expect(screen.queryByText("shot.png")).not.toBeInTheDocument();
  });

  // C7: every staged file uploaded at once; a few large ones took the pod
  // past its memory limit.
  it("sends staged files one after another", async () => {
    const pending: (() => void)[] = [];
    const onSendFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        }),
    );
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

    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.png", { type: "image/png" });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [first, second] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    expect(onSendFile).toHaveBeenCalledExactlyOnceWith(first);

    pending[0]?.();
    await waitFor(() => expect(onSendFile).toHaveBeenLastCalledWith(second));
    expect(onSendFile).toHaveBeenCalledTimes(2);
  });

  it("lets a staged file be removed before sending", () => {
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

    const file = new File(["pdf"], "bao-cao.pdf", { type: "application/pdf" });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gỡ bao-cao.pdf" }));
    expect(screen.queryByText("bao-cao.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gửi" })).not.toBeInTheDocument();
    expect(onSendFile).not.toHaveBeenCalled();
  });

  it("shows a read-only room as one line with the same disabled field", () => {
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          disabled
          readOnlyReason="muted"
          placeholder="Bạn bị cấm gửi tin trong phòng này — chỉ xem được."
          sendLabel="Gửi"
        />,
      ),
    );

    expect(screen.getByPlaceholderText("Bạn bị cấm gửi tin trong phòng này — chỉ xem được.")).toBeDisabled();
    expect(screen.queryByLabelText("Đính kèm")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ghi âm tin nhắn thoại")).not.toBeInTheDocument();
  });

  it("shows a blocked DM as a pill that says who blocked whom, with Bỏ chặn only when it was me", () => {
    const onUnblock = vi.fn();
    const props = {
      workspaceId: "ws1",
      draft: "",
      onDraftChange: vi.fn(),
      onSend: vi.fn(),
      disabled: true,
      readOnlyReason: "blocked" as const,
      placeholder: "Không thể nhắn tin",
      sendLabel: "Gửi",
    };
    const { rerender } = render(wrap(<ChatComposer {...props} blockedByMe onUnblock={onUnblock} />));
    expect(screen.getByRole("status")).toHaveTextContent("Bạn đã chặn người này — không thể nhắn tin riêng.");
    expect(screen.getByLabelText("Không thể nhắn tin")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chặn" }));
    expect(onUnblock).toHaveBeenCalledTimes(1);

    rerender(wrap(<ChatComposer {...props} blockedByMe={false} onUnblock={onUnblock} />));
    expect(screen.getByRole("status")).toHaveTextContent("Người này đã chặn bạn — không thể nhắn tin riêng.");
    expect(screen.queryByRole("button", { name: "Bỏ chặn" })).not.toBeInTheDocument();
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

describe("voice wave helpers", () => {
  it("folds a clip's loudness into a fixed number of bars, the loudest of each slice", () => {
    expect(clipShape([0.1, 0.9, 0.2, 0.4], 2)).toEqual([0.9, 0.4]);
    expect(clipShape([0.5], 3)).toEqual([0.5, 0.5, 0.5]);
    expect(clipShape([], 2)).toEqual([0, 0]);
  });

  it("reads silence as 0 and a full-scale wave as 1", () => {
    expect(rmsLevel(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(rmsLevel(new Uint8Array([0, 255, 0, 255]))).toBe(1);
    expect(rmsLevel(new Uint8Array([]))).toBe(0);
  });
});
