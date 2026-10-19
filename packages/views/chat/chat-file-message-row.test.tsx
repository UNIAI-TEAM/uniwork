import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatFileMessageRow } from "./chat-file-message-row";

initI18n();

vi.mock("@uniwork/core/api/endpoints/chat", () => ({
  getChatRoomMessage: vi.fn(),
}));
// pdf.js needs a real canvas and worker; the card is tested against what it returns.
vi.mock("./chat-pdf-render", () => ({ renderChatPdfFirstPage: vi.fn() }));

import { getChatRoomMessage } from "@uniwork/core/api/endpoints/chat";
import { renderChatPdfFirstPage } from "./chat-pdf-render";

/** A storage response whose bytes arrive when the test pushes them; the fetch's signal errors it. */
function controlledFetch(total: number) {
  let push!: ReadableStreamDefaultController<Uint8Array>;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = controller;
      },
    });
    init?.signal?.addEventListener("abort", () => push.error(new DOMException("Aborted", "AbortError")));
    return Promise.resolve(new Response(body, { headers: { "Content-Length": String(total) } }));
  });
  return { fetchMock, push: (size: number) => push.enqueue(new Uint8Array(size)), end: () => push.close() };
}

function spyAnchor() {
  const anchor = { href: "", download: "", rel: "", click: vi.fn() };
  const createElement = document.createElement.bind(document);
  const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "a" ? (anchor as unknown as HTMLAnchorElement) : createElement(tag)) as typeof document.createElement);
  return { anchor, restore: () => spy.mockRestore() };
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

/** A file message as the list hands it over: metadata plus signed storage URLs (UNI-1633). */
function fileMessage(
  id: string,
  file: { filename: string; content_type: string; size_bytes: number },
  overrides: Partial<NonNullable<ChatMessage["file"]>> = {},
  message: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    sender: "user1",
    body: file.filename,
    kind: "file",
    ts: Date.now(),
    reactions: {},
    ...message,
    file: {
      ...file,
      url: `https://storage.test/${id}`,
      download_url: `https://storage.test/${id}?download=1`,
      thumb_url: `https://storage.test/${id}-thumb`,
      url_expires_at: inAnHour(),
      ...overrides,
    },
  };
}

function renderRow(message: ChatMessage, props: Partial<Parameters<typeof ChatFileMessageRow>[0]> = {}) {
  return render(
    wrap(
      <ChatFileMessageRow
        workspaceId="ws1"
        roomId="room1"
        message={message}
        senderLabel="An"
        isOwn
        showSenderName={false}
        compactTop={false}
        showAvatar={false}
        {...props}
      />,
    ),
  );
}

describe("ChatFileMessageRow", () => {
  beforeEach(() => {
    vi.mocked(getChatRoomMessage).mockReset();
  });

  it("shows a PDF as a file card; a large one reads its first page only when asked", async () => {
    vi.mocked(renderChatPdfFirstPage).mockResolvedValue({ pages: 6, src: "data:image/jpeg;base64,AAAA" });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    // On screen (test/media-stub.ts reports every card visible) but past the auto-preview size.
    renderRow(
      fileMessage("message1", { filename: "sprint.pdf", content_type: "application/pdf", size_bytes: 11 * 1024 * 1024 }),
    );

    expect(screen.getByText("sprint.pdf")).toBeInTheDocument();
    expect(screen.getByText("11,0 MB · PDF")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải sprint.pdf xuống" })).toBeInTheDocument();
    await Promise.resolve();
    expect(renderChatPdfFirstPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hiện bản xem trước" }));
    expect(await screen.findByRole("img", { name: "Trang đầu của PDF, 6 trang" })).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,AAAA",
    );
    expect(renderChatPdfFirstPage).toHaveBeenCalledWith("https://storage.test/message1");
    expect(screen.getByText("Trang 1 / 6")).toBeInTheDocument();
    expect(screen.getByText("11,0 MB · PDF · 6 trang")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Xem sprint.pdf" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://storage.test/message1", "_blank", "noopener,noreferrer"));
    expect(getChatRoomMessage).not.toHaveBeenCalled();
    open.mockRestore();
    vi.mocked(renderChatPdfFirstPage).mockReset();
  });

  it("reads a small PDF once it scrolls into view and opens it from a fallback when the page cannot be drawn", async () => {
    vi.mocked(renderChatPdfFirstPage).mockRejectedValue(new Error("Invalid PDF structure"));
    renderRow(fileMessage("pdf-auto", { filename: "hong.pdf", content_type: "application/pdf", size_bytes: 4096 }));
    await waitFor(() => expect(renderChatPdfFirstPage).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Hiện bản xem trước" }));
    expect(await screen.findByText("Không xem trước được. Bấm để mở tệp.")).toBeInTheDocument();
    expect(screen.getByText("4 KB · PDF")).toBeInTheDocument();

    vi.mocked(renderChatPdfFirstPage).mockReset();
  });

  it("shows a photo's signed thumbnail and previews the original in the chat on click", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderRow(fileMessage("message3", { filename: "photo.jpg", content_type: "image/jpeg", size_bytes: 4_000_000 }));

    expect(screen.getByRole("img", { name: "photo.jpg" })).toHaveAttribute("src", "https://storage.test/message3-thumb");

    fireEvent.click(screen.getByRole("button", { name: "Xem photo.jpg" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "photo.jpg" })).toHaveAttribute(
      "src",
      "https://storage.test/message3",
    );
    expect(open).not.toHaveBeenCalled();
    expect(getChatRoomMessage).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("shows a GIF whole, from its original URL", () => {
    renderRow(fileMessage("gif1", { filename: "vui.gif", content_type: "image/gif", size_bytes: 900 }));
    expect(screen.getByRole("img", { name: "vui.gif" })).toHaveAttribute("src", "https://storage.test/gif1");
  });

  it("exposes message actions when handlers are provided", () => {
    const onReply = vi.fn();
    renderRow(
      fileMessage("message3", { filename: "long.png", content_type: "image/png", size_bytes: 116_326 }, {}, {
        reactions: { "👍": 1 },
      }),
      {
        onReply,
        onReact: vi.fn(),
        onThread: vi.fn(),
        onPin: vi.fn(),
        onCopy: vi.fn(),
        onDelete: vi.fn(),
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Trả lời" }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(screen.getByText("👍")).toBeInTheDocument();
    // A file cannot be edited, so the action is left out rather than shown disabled.
    expect(screen.queryByRole("button", { name: "Sửa" })).not.toBeInTheDocument();
  });

  it("formats byte sizes and shows peer sender chrome", () => {
    renderRow(
      fileMessage("message3", { filename: "tiny.txt", content_type: "text/plain", size_bytes: 12 }, {}, {
        sender: "user2",
        reactions: { "🔥": 2 },
      }),
      { senderLabel: "Binh", isOwn: false, showSenderName: true, compactTop: true, showAvatar: true },
    );
    expect(screen.getByText("12 B")).toBeInTheDocument();
    expect(screen.getByText("Binh")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("streams a download with its progress, and cancels it", async () => {
    const { fetchMock, push } = controlledFetch(2 * 1024 * 1024);
    vi.stubGlobal("fetch", fetchMock);
    renderRow(
      fileMessage("dl-progress", { filename: "big.bin", content_type: "application/octet-stream", size_bytes: 2 * 1024 * 1024 }),
    );
    expect(screen.getByText("2,0 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải big.bin xuống" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("https://storage.test/dl-progress?download=1", expect.anything()),
    );
    push(1024 * 1024);
    expect(await screen.findByText("Đang tải xuống · 1,0 / 2,0 MB")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Đang tải big.bin" })).toHaveAttribute("aria-valuenow", "50");

    fireEvent.click(screen.getByRole("button", { name: "Hủy tải big.bin" }));
    expect(await screen.findByRole("button", { name: "Tải big.bin xuống" })).toBeEnabled();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("saves the finished download from memory under the file's name", async () => {
    const { fetchMock, push, end } = controlledFetch(12);
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:chat-file");
    const { anchor, restore } = spyAnchor();
    renderRow(fileMessage("dl-done", { filename: "notes.txt", content_type: "text/plain", size_bytes: 12 }));
    fireEvent.click(screen.getByRole("button", { name: "Tải notes.txt xuống" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    push(12);
    end();
    await waitFor(() => expect(anchor.click).toHaveBeenCalled());
    expect(anchor.href).toBe("blob:chat-file");
    expect(anchor.download).toBe("notes.txt");
    restore();
    createObjectURL.mockRestore();
    vi.unstubAllGlobals();
  });

  it("falls back to a plain link when the browser cannot fetch from storage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { anchor, restore } = spyAnchor();
    renderRow(
      fileMessage("message4", { filename: "big.bin", content_type: "application/octet-stream", size_bytes: 2 * 1024 * 1024 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tải big.bin xuống" }));
    await waitFor(() => expect(anchor.click).toHaveBeenCalled());
    expect(anchor.href).toBe("https://storage.test/message4?download=1");
    expect(anchor.download).toBe("big.bin");
    expect(getChatRoomMessage).not.toHaveBeenCalled();
    restore();
    vi.unstubAllGlobals();
  });

  it("hands the download to the UniChat shell, which saves it natively", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const downloadURL = vi.fn(() => Promise.resolve());
    (window as unknown as { desktopAPI?: unknown }).desktopAPI = { app: "unichat", downloadURL };
    renderRow(fileMessage("dl-desktop", { filename: "plan.docx", content_type: "application/msword", size_bytes: 900 }));
    fireEvent.click(screen.getByRole("button", { name: "Tải plan.docx xuống" }));
    await waitFor(() =>
      expect(downloadURL).toHaveBeenCalledWith("https://storage.test/dl-desktop?download=1", "plan.docx"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    delete (window as unknown as { desktopAPI?: unknown }).desktopAPI;
    vi.unstubAllGlobals();
  });

  it("signs a fresh download URL when the one it holds has expired", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { anchor, restore } = spyAnchor();
    vi.mocked(getChatRoomMessage).mockResolvedValueOnce({
      id: "message6",
      file: { download_url: "https://storage.test/message6?download=2" },
    } as Awaited<ReturnType<typeof getChatRoomMessage>>);

    renderRow(
      fileMessage(
        "message6",
        { filename: "cu.txt", content_type: "text/plain", size_bytes: 10 },
        { url_expires_at: "2020-01-01T00:00:00Z" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tải cu.txt xuống" }));
    await waitFor(() => expect(anchor.click).toHaveBeenCalled());
    expect(getChatRoomMessage).toHaveBeenCalledWith("ws1", "room1", "message6");
    expect(anchor.href).toBe("https://storage.test/message6?download=2");
    restore();
    vi.unstubAllGlobals();
  });

  it("asks for the message again when a photo's URL has expired", async () => {
    vi.mocked(getChatRoomMessage).mockResolvedValue(null);
    renderRow(
      fileMessage(
        "message7",
        { filename: "cu.png", content_type: "image/png", size_bytes: 10 },
        { url_expires_at: "2020-01-01T00:00:00Z" },
      ),
    );
    await waitFor(() => expect(getChatRoomMessage).toHaveBeenCalledWith("ws1", "room1", "message7"));
    expect(screen.queryByRole("img", { name: "cu.png" })).not.toBeInTheDocument();
  });

  it("shows an error state when the server signed no URL", () => {
    renderRow(
      fileMessage(
        "message5",
        { filename: "broken.png", content_type: "image/png", size_bytes: 10 },
        { url: "", thumb_url: "", download_url: "", url_expires_at: "" },
      ),
    );
    expect(screen.getByText("Không tải được tệp.")).toBeInTheDocument();
    expect(getChatRoomMessage).not.toHaveBeenCalled();
  });
});
