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

describe("ChatComposer document share picker", () => {
  const docx = () =>
    new File(["pk"], "ke-hoach.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  const renderComposer = (over: Record<string, unknown> = {}) =>
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          onSendFile={vi.fn()}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
          {...over}
        />,
      ),
    );

  it("shows the picker for an allowlisted file when the room allows documents", async () => {
    const onSendDocument = vi.fn();
    renderComposer({ canSendDocument: true, onSendDocument });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), { clipboardData: { files: [docx()] } });
    expect(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    // The default is Nhận xét.
    await waitFor(() => expect(onSendDocument).toHaveBeenCalledExactlyOnceWith(expect.any(File), "comment"));
  });

  it("hides the picker when the room does not allow documents", async () => {
    const onSendDocument = vi.fn();
    const onSendFile = vi.fn();
    renderComposer({ canSendDocument: false, onSendDocument, onSendFile });
    // A file on BOTH allowlists: it stages as a plain chat file and the
    // absence of the picker is the flag's doing, not a refused staging.
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [new File(["%PDF"], "bao-cao.pdf", { type: "application/pdf" })] },
    });
    expect(screen.queryByLabelText("Quyền cho mọi người trong cuộc trò chuyện")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(onSendFile).toHaveBeenCalledWith(expect.any(File)));
    expect(onSendDocument).not.toHaveBeenCalled();
  });



  it("stages document-only kinds only when the room allows documents", () => {
    const onSendDocument = vi.fn();
    const { unmount } = renderComposer({ canSendDocument: true, onSendDocument });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [new File(["x"], "ghi-chu.md", { type: "text/markdown" })] },
    });
    // .md is not chat-attachable, but the document allowlist takes it.
    expect(screen.getByText("ghi-chu.md")).toBeInTheDocument();
    expect(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện")).toBeInTheDocument();
    unmount();

    renderComposer({ canSendDocument: false, onSendDocument });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [new File(["x"], "ghi-chu.md", { type: "text/markdown" })] },
    });
    expect(screen.queryByText("ghi-chu.md")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quyền cho mọi người trong cuộc trò chuyện")).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });

  it("sends each level through the document route and 'Chỉ gửi tệp' through the file route", async () => {
    const onSendDocument = vi.fn();
    const onSendFile = vi.fn();
    for (const [label, level] of [
      ["Chỉ xem", "view"],
      ["Nhận xét", "comment"],
      ["Chỉnh sửa", "edit"],
    ] as const) {
      const { unmount } = renderComposer({ canSendDocument: true, onSendDocument, onSendFile });
      fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), { clipboardData: { files: [docx()] } });
      fireEvent.click(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện"));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: label }));
      fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
      await waitFor(() => expect(onSendDocument).toHaveBeenLastCalledWith(expect.any(File), level));
      unmount();
    }
    const { unmount } = renderComposer({ canSendDocument: true, onSendDocument, onSendFile });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), { clipboardData: { files: [docx()] } });
    fireEvent.click(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Chỉ gửi tệp" }));
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(onSendFile).toHaveBeenCalledWith(expect.any(File)));
    expect(onSendDocument).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("labels the picker's default choice Nhận xét", () => {
    renderComposer({ canSendDocument: true, onSendDocument: vi.fn() });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), { clipboardData: { files: [docx()] } });
    // The closed trigger itself reads the level it will send at.
    expect(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện")).toHaveTextContent("Nhận xét");
  });

  it("sends a mixed batch (pdf + png) as plain files and never shows the picker", async () => {
    // RFC-01: the picker is hidden the moment one staged file cannot be a
    // document, and nothing may take the document route without that visible
    // level choice — the share grant has to be a decision the user saw.
    const onSendDocument = vi.fn();
    const onSendFile = vi.fn();
    renderComposer({ canSendDocument: true, onSendDocument, onSendFile });
    const pdf = new File(["%PDF"], "bao-cao.pdf", { type: "application/pdf" });
    const png = new File(["png"], "anh.png", { type: "image/png" });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [pdf, png] },
    });
    expect(screen.queryByLabelText("Quyền cho mọi người trong cuộc trò chuyện")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() => expect(onSendFile).toHaveBeenCalledTimes(2));
    expect(onSendFile).toHaveBeenNthCalledWith(1, pdf);
    expect(onSendFile).toHaveBeenNthCalledWith(2, png);
    expect(onSendDocument).not.toHaveBeenCalled();
  });

  it("offers no 'Chỉ gửi tệp' choice when a staged file cannot go by the plain route", async () => {
    // RFC-02: a document-only kind and a pdf over the 25 MB chat ceiling both
    // take the document route or nothing — the plain route would only refuse.
    const cases: { name: string; file: File }[] = [
      {
        name: "a document-only kind (.pptx)",
        file: new File(
          ["x"],
          "trinh-bay.pptx",
          { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
        ),
      },
      {
        name: "a pdf over the 25 MB chat ceiling",
        file: (() => {
          const f = new File(["x"], "nang.pdf", { type: "application/pdf" });
          Object.defineProperty(f, "size", { value: 26 * 1024 * 1024 });
          return f;
        })(),
      },
    ];
    for (const { name, file } of cases) {
      const { unmount } = renderComposer({ canSendDocument: true, onSendDocument: vi.fn(), onSendFile: vi.fn() });
      fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), { clipboardData: { files: [file] } });
      fireEvent.click(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện"));
      expect(
        await screen.findByRole("menuitemradio", { name: "Chỉ xem" }),
        `${name}: the levels still show`,
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("menuitemradio", { name: "Chỉ gửi tệp" }),
        `${name}: no file choice`,
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("keeps the 'Chỉ gửi tệp' choice for a file the plain route accepts", async () => {
    renderComposer({ canSendDocument: true, onSendDocument: vi.fn(), onSendFile: vi.fn() });
    fireEvent.paste(screen.getByLabelText("Nhập tin nhắn…"), {
      clipboardData: { files: [new File(["%PDF"], "bao-cao.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByLabelText("Quyền cho mọi người trong cuộc trò chuyện"));
    expect(await screen.findByRole("menuitemradio", { name: "Chỉ gửi tệp" })).toBeInTheDocument();
  });
});
