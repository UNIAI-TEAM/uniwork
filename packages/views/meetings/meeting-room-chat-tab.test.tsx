import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
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

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không gửi được tin nhắn"));
    expect(box).toHaveValue("Xin chào");
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
  it("paints bubbles like the chat module: a brand wash for mine, muted for theirs", () => {
    liveMessages = [
      { id: "a", message: "Chào cả nhà", timestamp: 1_000, from: { identity: "u-other", name: "Lan" } },
      { id: "b", message: "Chào Lan", timestamp: 2_000, from: { identity: "u-me", name: "Tôi", isLocal: true } },
    ];
    render(wrapWithNav(<MeetingRoomChatTab />));
    const theirs = screen.getByText("Chào cả nhà");
    const mine = screen.getByText("Chào Lan");
    expect(mine).toHaveClass("bg-brand-subtle");
    expect(mine).not.toHaveClass("bg-brand");
    expect(theirs).toHaveClass("bg-muted");
  });
});
