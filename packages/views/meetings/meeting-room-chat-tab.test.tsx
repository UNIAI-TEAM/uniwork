import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { CHAT_WALL_DOT_CLASS } from "@uniwork/core/chat/chat-wallpaper-resolve";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomChatTab } from "./meeting-room-chat-tab";

type LiveMessage = {
  id: string;
  message: string;
  timestamp: number;
  from: { identity: string; name: string; isLocal?: boolean };
};
let liveMessages: LiveMessage[] = [];

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@livekit/components-react", () => ({
  useLocalParticipant: () => ({ localParticipant: { identity: "u-me" } }),
  useChat: () => ({ chatMessages: liveMessages, send: vi.fn(), isSending: false }),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockReset();
  liveMessages = [];
});

function chatRespond(list: () => Promise<unknown>, post: () => Promise<unknown> = () => Promise.resolve({})) {
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    if (String(path).endsWith("/chat")) return init?.method === "POST" ? post() : list();
    return Promise.resolve({});
  });
}

const EMPTY = "Chưa có tin nhắn.";

describe("MeetingRoomChatTab (persisted)", () => {
  it("shows a loading skeleton, not the empty copy, while messages load", () => {
    chatRespond(() => new Promise(() => {}));
    render(wrapWithNav(<MeetingRoomChatTab meetingId="m1" />));

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once an empty list arrives", async () => {
    chatRespond(() => Promise.resolve({ messages: [] }));
    render(wrapWithNav(<MeetingRoomChatTab meetingId="m1" />));

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when messages fail", async () => {
    chatRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    render(wrapWithNav(<MeetingRoomChatTab meetingId="m1" />));

    expect(await screen.findByText("Không tải được tin nhắn.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    chatRespond(() => Promise.resolve({ messages: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("opens on the newest page and loads earlier messages on demand", async () => {
    const row = (id: string, sec: number) => ({
      id,
      meeting_id: "m1",
      sender_identity: "u-other",
      sender_name: "An",
      message: `tin ${id}`,
      sent_at: `2026-08-29T02:00:0${sec}Z`,
    });
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/chat")) return Promise.resolve({ messages: [row("c", 3)], older_cursor: "o3", after_cursor: "t3" });
      if (p.endsWith("/chat?before=o3")) return Promise.resolve({ messages: [row("a", 1), row("b", 2)] });
      return Promise.resolve({});
    });
    render(wrapWithNav(<MeetingRoomChatTab meetingId="m1" />));

    expect(await screen.findByText("tin c")).toBeInTheDocument();
    expect(screen.queryByText("tin a")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải tin nhắn cũ hơn" }));
    expect(await screen.findByText("tin a")).toBeInTheDocument();
    expect(screen.getByText("tin b")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải tin nhắn cũ hơn" })).not.toBeInTheDocument();
  });

  it("tells the sender when a message did not go out and keeps the draft", async () => {
    chatRespond(
      () => Promise.resolve({ messages: [] }),
      () => Promise.reject(new ApiError("Không gửi được tin nhắn", "internal", 500)),
    );
    render(wrapWithNav(<MeetingRoomChatTab meetingId="m1" />));
    await screen.findByText(EMPTY);

    const box = screen.getByRole("textbox", { name: "Trò chuyện" });
    fireEvent.change(box, { target: { value: "Xin chào" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));

    // An internal error reads as the localized copy, not the server's own sentence.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("UniWork đang gặp sự cố. Thử lại sau vài phút."));
    expect(box).toHaveValue("Xin chào");
  });

  it("does not send from the inactive button: empty draft, or while a message is on its way", async () => {
    const post = vi.fn(() => new Promise<unknown>(() => {}));
    chatRespond(() => Promise.resolve({ messages: [] }), post);
    render(wrapWithNav(<MeetingRoomChatTab meetingId="m1" />));
    await screen.findByText(EMPTY);

    const button = screen.getByRole("button", { name: "Gửi" });
    fireEvent.click(button);
    await act(async () => {});
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Trò chuyện" }), { target: { value: "Xin chào" } });
    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));

    fireEvent.click(button);
    await act(async () => {});
    expect(post).toHaveBeenCalledOnce();
  });

  it("does not send on the Enter that ends an IME composition", async () => {
    const post = vi.fn(() => Promise.resolve({}));
    chatRespond(() => Promise.resolve({ messages: [] }), post);
    render(wrapWithNav(<MeetingRoomChatTab meetingId="m1" />));
    await screen.findByText(EMPTY);

    const box = screen.getByRole("textbox", { name: "Trò chuyện" });
    fireEvent.change(box, { target: { value: "Xin chaof" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(post).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
  });
});

function live(n: number): LiveMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `l${i}`,
    message: `Tin ${i}`,
    timestamp: 1_000 + i,
    from: { identity: "u-other", name: "Lan" },
  }));
}

/** jsdom has no layout: give the list a fixed viewport and a settable scroll position. */
function fakeScroll(el: HTMLElement, height: { value: number }) {
  let top = 0;
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 200 });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height.value });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
}

describe("MeetingRoomChatTab auto-scroll", () => {
  it("leaves the reader where they are when they have scrolled up", () => {
    liveMessages = live(3);
    const { rerender } = render(wrapWithNav(<MeetingRoomChatTab />));
    const list = screen.getByRole("list");
    const height = { value: 1000 };
    fakeScroll(list, height);
    list.scrollTop = 100;
    fireEvent.scroll(list);

    liveMessages = live(4);
    height.value = 1200;
    act(() => {
      rerender(wrapWithNav(<MeetingRoomChatTab />));
    });
    expect(list.scrollTop).toBe(100);
  });

  it("follows new messages when the reader is already at the bottom", () => {
    liveMessages = live(3);
    const { rerender } = render(wrapWithNav(<MeetingRoomChatTab />));
    const list = screen.getByRole("list");
    const height = { value: 1000 };
    fakeScroll(list, height);
    list.scrollTop = 800;
    fireEvent.scroll(list);

    liveMessages = live(4);
    height.value = 1200;
    act(() => {
      rerender(wrapWithNav(<MeetingRoomChatTab />));
    });
    expect(list.scrollTop).toBe(1200);
  });
});

describe("MeetingRoomChatTab bubbles", () => {
  it("paints the brand fill for mine and the grey bubble for theirs on the plain panel", () => {
    liveMessages = [
      { id: "a", message: "Chào cả nhà", timestamp: 1_000, from: { identity: "u-other", name: "Lan" } },
      { id: "b", message: "Chào Lan", timestamp: 2_000, from: { identity: "u-me", name: "Tôi", isLocal: true } },
    ];
    render(wrapWithNav(<MeetingRoomChatTab />));
    const theirs = screen.getByText("Chào cả nhà");
    const mine = screen.getByText("Chào Lan");
    expect(mine).toHaveClass("bg-chat-bubble-own", "text-chat-bubble-own-foreground");
    expect(mine).not.toHaveClass("text-foreground");
    expect(theirs).toHaveClass("bg-surface-hover", "text-foreground", "rounded-tl-[4px]");
    expect(mine).toHaveClass("rounded-tr-[4px]");
  });

  it("makes a web address in a message a link that opens apart", () => {
    liveMessages = [
      { id: "a", message: "Báo cáo QA: https://qa.saomai.vn/r/1043", timestamp: 1_000, from: { identity: "u-other", name: "Tuấn" } },
    ];
    render(wrapWithNav(<MeetingRoomChatTab />));
    const link = screen.getByRole("link", { name: "https://qa.saomai.vn/r/1043" });
    expect(link).toHaveAttribute("href", "https://qa.saomai.vn/r/1043");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("underline", "text-brand-subtle-foreground");
  });

  it("names the sender of my own messages for screen readers, with no visible name", () => {
    liveMessages = [
      { id: "b", message: "Chào Lan", timestamp: 2_000, from: { identity: "u-me", name: "Tôi", isLocal: true } },
    ];
    render(wrapWithNav(<MeetingRoomChatTab />));
    const own = screen.getByText("Chào Lan").closest("li")!;
    const name = within(own).getByText("Bạn");
    expect(name).toHaveClass("sr-only");
  });
});

describe("MeetingRoomChatTab look", () => {
  const DAY = 86_400_000;

  it("draws no day divider when every message is from one day", () => {
    const now = Date.now();
    liveMessages = [
      { id: "a", message: "Một", timestamp: now, from: { identity: "u-other", name: "Lan" } },
      { id: "b", message: "Hai", timestamp: now, from: { identity: "u-me", name: "Tôi", isLocal: true } },
    ];
    render(wrapWithNav(<MeetingRoomChatTab />));
    expect(screen.getByText("Một")).toBeInTheDocument();
    expect(screen.queryByText("Hôm nay")).not.toBeInTheDocument();
  });

  it("draws day dividers when the messages span two days", () => {
    const now = Date.now();
    liveMessages = [
      { id: "a", message: "Hôm trước", timestamp: now - DAY, from: { identity: "u-other", name: "Lan" } },
      { id: "b", message: "Hôm nay nói", timestamp: now, from: { identity: "u-other", name: "Lan" } },
    ];
    render(wrapWithNav(<MeetingRoomChatTab />));
    expect(screen.getByText("Hôm qua")).toBeInTheDocument();
    expect(screen.getByText("Hôm nay")).toBeInTheDocument();
  });

  it("puts the messages on the plain panel, not the dotted chat wall", () => {
    liveMessages = live(1);
    render(wrapWithNav(<MeetingRoomChatTab />));
    const list = screen.getByRole("list");
    for (const cls of CHAT_WALL_DOT_CLASS.split(" ")) expect(list).not.toHaveClass(cls);
  });

  it("types into a 16px gradient-edge box with a round 32px send button, no beam and no modes", () => {
    render(wrapWithNav(<MeetingRoomChatTab />));
    const box = screen.getByRole("textbox", { name: "Trò chuyện" });
    expect(box).toHaveAttribute("placeholder", "Nhắn cho mọi người…");
    const frame = box.closest<HTMLElement>(".ai-edge");
    expect(frame).not.toBeNull();
    expect(frame).not.toHaveClass("border-beam-ai");
    expect(frame).not.toHaveClass("ai-edge-note");
    expect(frame!.style.getPropertyValue("--ai-edge-radius")).toBe("16px");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    const sendButton = within(frame!).getByRole("button", { name: "Gửi" });
    expect(sendButton).toHaveClass("size-8", "rounded-full", "pointer-coarse:size-11");
    expect(sendButton.querySelector("svg.lucide-arrow-up")).not.toBeNull();
    expect(sendButton).toHaveAttribute("aria-disabled", "true");
    expect(sendButton).not.toHaveClass("bg-brand");

    fireEvent.change(box, { target: { value: "Xin chào" } });
    expect(sendButton).not.toHaveAttribute("aria-disabled");
    expect(sendButton).toHaveClass("bg-brand", "text-brand-foreground");
  });
});
