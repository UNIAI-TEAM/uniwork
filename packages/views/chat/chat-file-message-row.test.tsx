import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatFileMessageRow } from "./chat-file-message-row";

initI18n();

vi.mock("@uniwork/core/api/endpoints/chat", () => ({
  getChatRoomMessage: vi.fn(),
}));

import { getChatRoomMessage } from "@uniwork/core/api/endpoints/chat";

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

  it("shows a PDF as a file card and opens its preview from storage only when asked", () => {
    renderRow(fileMessage("message1", { filename: "sprint.pdf", content_type: "application/pdf", size_bytes: 2048 }));

    expect(screen.getByText("sprint.pdf")).toBeInTheDocument();
    expect(screen.getByText("2,0 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải sprint.pdf xuống" })).toBeInTheDocument();
    // Nothing loads for a PDF nobody opened.
    expect(screen.queryByTitle("Xem trước PDF")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hiện bản xem trước" }));
    expect(screen.getByTitle("Xem trước PDF")).toHaveAttribute("src", "https://storage.test/message1");
    expect(getChatRoomMessage).not.toHaveBeenCalled();
  });

  it("shows a photo's signed thumbnail and opens the original in a new tab on click", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    renderRow(fileMessage("message3", { filename: "photo.jpg", content_type: "image/jpeg", size_bytes: 4_000_000 }));

    expect(screen.getByRole("img", { name: "photo.jpg" })).toHaveAttribute("src", "https://storage.test/message3-thumb");

    fireEvent.click(screen.getByRole("button", { name: "Mở photo.jpg" }));
    // The tab opens inside the click so no popup blocker stops it.
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.href).toBe("https://storage.test/message3"));
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

  it("downloads from the signed download URL", async () => {
    const anchor = { href: "", download: "", rel: "", click: vi.fn() };
    const createElement = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "a" ? (anchor as unknown as HTMLAnchorElement) : createElement(tag)) as typeof document.createElement);

    renderRow(
      fileMessage("message4", { filename: "big.bin", content_type: "application/octet-stream", size_bytes: 2 * 1024 * 1024 }),
    );
    expect(screen.getByText("2,0 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải big.bin xuống" }));
    await waitFor(() => expect(anchor.click).toHaveBeenCalled());
    expect(anchor.href).toBe("https://storage.test/message4?download=1");
    expect(anchor.download).toBe("big.bin");
    expect(getChatRoomMessage).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("signs a fresh download URL when the one it holds has expired", async () => {
    const anchor = { href: "", download: "", rel: "", click: vi.fn() };
    const createElement = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "a" ? (anchor as unknown as HTMLAnchorElement) : createElement(tag)) as typeof document.createElement);
    vi.mocked(getChatRoomMessage).mockResolvedValueOnce({
      id: "message6",
      file: { download_url: "https://storage.test/message6?download=2" },
    } as Awaited<ReturnType<typeof getChatRoomMessage>>);

    renderRow(
      fileMessage(
        "message6",
        { filename: "cu.pdf", content_type: "application/pdf", size_bytes: 10 },
        { url_expires_at: "2020-01-01T00:00:00Z" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Tải cu.pdf xuống" }));
    await waitFor(() => expect(anchor.click).toHaveBeenCalled());
    expect(getChatRoomMessage).toHaveBeenCalledWith("ws1", "room1", "message6");
    expect(anchor.href).toBe("https://storage.test/message6?download=2");
    spy.mockRestore();
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
