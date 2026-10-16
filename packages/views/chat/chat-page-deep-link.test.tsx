import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { useChatRoomMessages, useChatRooms } from "@uniwork/core/chat";
import {
  resetPendingChatMessagesForTests,
  usePendingChatMessagesStore,
} from "@uniwork/core/chat/pending-messages-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { User } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { ChatPageView } from "./chat-page-view";
import { pinChatScrollToBottom } from "./virtual-chat-message-list";

// Drive the real VirtualChatMessageList in jsdom with a 570px scrollport and ResizeObserver.
const resizeCallbacks = new Set<() => void>();
class ActiveResizeObserver {
  private cb: () => void;
  constructor(cb: ResizeObserverCallback) {
    this.cb = () => cb([], this);
  }
  observe() {
    resizeCallbacks.add(this.cb);
    queueMicrotask(this.cb);
  }
  unobserve() {}
  disconnect() {
    resizeCallbacks.delete(this.cb);
  }
}

// No socket: the page's realtime hooks see "not connected yet".
vi.mock("../../core/realtime/provider", async (orig) => ({
  ...(await orig<typeof import("../../core/realtime/provider")>()),
  useWS: () => ({ client: null }),
  useOptionalWS: () => ({ client: null }),
}));

vi.mock("./chat-voice-call-host", async (orig) => ({
  ...(await orig<typeof import("./chat-voice-call-host")>()),
  useChatVoiceCall: () => ({ startCall: vi.fn(), acceptCall: vi.fn(), declineCall: vi.fn(), inCall: false }),
}));

const reader: User = {
  id: "u-b", email: "b@example.com", display_name: "B",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const WS = "ws1";
const room = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id, kind, name: id, workspace_id: WS, member_user_ids: ["u-a", "u-b"], ...extra,
});
const ROOMS = [
  room("r-ws", "channel", { is_default: true }),
  room("r-dm", "dm", { peer_user_id: "u-a", peer_email: "a@example.com", peer_display_name: "A" }),
  room("r-ch", "channel", { visibility: "public" }),
];
const textMessage = (roomId: string, id: string, senderId: string, idx: number) => ({
  id, room_id: roomId, workspace_id: WS, sender_id: senderId, sender_display_name: senderId, kind: "text",
  body: `msg ${idx}`, created_at: new Date(Date.UTC(2026, 9, 16, 5, 0, idx)).toISOString(),
});
const fileMessage = (roomId: string, id: string) => ({
  id, room_id: roomId, workspace_id: WS, sender_id: "u-a", sender_display_name: "A", kind: "file",
  body: "de-xuat.txt", created_at: new Date(Date.UTC(2026, 9, 16, 5, 0, 14)).toISOString(),
  file: { filename: "de-xuat.txt", content_type: "text/plain", size_bytes: 27 },
});
function buildTimeline(roomId: string, fileId: string, lastSenderInAround: string) {
  const before = Array.from({ length: 14 }, (_, i) => textMessage(roomId, `${roomId}-b${i}`, "u-a", i));
  const after = Array.from({ length: 30 }, (_, i) =>
    textMessage(roomId, `${roomId}-a${i}`, i === 24 ? lastSenderInAround : "u-a", 15 + i),
  );
  const all = [...before, fileMessage(roomId, fileId), ...after];
  return { latest: all, around: all.slice(0, 40) };
}
const TIMELINES: Record<string, { latest: unknown[]; around: unknown[] }> = {
  "r-ws": { latest: [], around: [] },
  // DM around-window ends with a message from the reader (u-b); channel ends with u-a.
  "r-dm": buildTimeline("r-dm", "m-dm", reader.id),
  "r-ch": buildTimeline("r-ch", "m-ch", "u-a"),
};

// The reader joins the workspace room on first open (ensure-room), so the first list lacks it.
let joined = true;
let aroundDelayMs = 0;
let latestDelayMs = 0;
let aroundFails = false;
let aroundEmpty = false;
const later = <T,>(value: T, ms: number) =>
  ms <= 0 ? Promise.resolve(value) : new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

function serve(path: string): Promise<unknown> {
  const url = path.split("?")[0] ?? "";
  if (url.endsWith(`/workspaces/${WS}/chat/rooms`)) return Promise.resolve({ rooms: joined ? ROOMS : ROOMS.slice(1) });
  if (url.endsWith(`/workspaces/${WS}/chat/room`)) {
    joined = true;
    return later({ workspace_id: WS, room_id: "r-ws" }, 50);
  }
  const around = /\/chat\/rooms\/([^/]+)\/messages\/around\/([^/]+)$/.exec(url);
  if (around) {
    if (aroundFails) return later(null, aroundDelayMs).then(() => Promise.reject(new Error("not found")));
    if (aroundEmpty) return later({ messages: [] }, aroundDelayMs);
    return later({ messages: TIMELINES[around[1] ?? ""]?.around ?? [] }, aroundDelayMs);
  }
  const latest = /\/chat\/rooms\/([^/]+)\/messages$/.exec(url);
  if (latest) return later({ messages: TIMELINES[latest[1] ?? ""]?.latest ?? [] }, latestDelayMs);
  return Promise.resolve({});
}

function open(query: string, { async = false, cached = false } = {}) {
  const nav = fakeNav(`/acme/team/chat?${query}`);
  if (async) {
    // The web adapter asks the leave guards first and Next commits the URL after
    // its RSC round trip: every move lands later than the call.
    const { push, replace } = nav;
    nav.push = vi.fn((href: string) => void later(null, 300).then(() => push(href)));
    nav.replace = vi.fn((href: string) => void later(null, 300).then(() => replace(href)));
  }
  const page = <ChatPageView workspaceId={WS} currentUserId={reader.id} />;
  render(wrapWithNav(cached ? <AfterRoomsCached>{page}</AfterRoomsCached> : page, nav));
  return nav;
}

/** The voice-call host above the routes reads the rooms first: Chat mounts on a warm cache. */
function AfterRoomsCached({ children }: { children: React.ReactNode }) {
  const { isSuccess } = useChatRooms(WS);
  const [ready, setReady] = useState(false);
  if (isSuccess && !ready) setReady(true);
  return ready ? children : null;
}

async function flushFramesAndObservers() {
  for (let i = 0; i < 4; i++) {
    for (const cb of Array.from(resizeCallbacks)) cb();
    await later(null, 20);
  }
  await later(null, 40);
}

async function expectHighlighted(messageId: string) {
  await waitFor(() => expect(document.getElementById(`chat-msg-${messageId}`)).not.toBeNull(), { timeout: 4000 });
  await waitFor(() => expect(document.getElementById(`chat-msg-${messageId}`)?.className).toMatch(/ring-brand/), {
    timeout: 4000,
  });
  await flushFramesAndObservers();
  expect(document.getElementById(`chat-msg-${messageId}`)).not.toBeNull();
  expect(document.getElementById(`chat-msg-${messageId}`)?.className).toMatch(/ring-brand/);
}

const scrollTops = new WeakMap<HTMLElement, number>();

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(reader);
  resetPendingChatMessagesForTests();
  joined = true;
  aroundDelayMs = 0;
  latestDelayMs = 0;
  aroundFails = false;
  aroundEmpty = false;
  resizeCallbacks.clear();
  vi.restoreAllMocks();
  vi.stubGlobal("ResizeObserver", ActiveResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 570 });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 3520 });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      scrollTops.set(this, Math.max(0, Math.min(value, 3520 - 570)));
      this.dispatchEvent(new Event("scroll"));
    },
  });
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, arg1?: ScrollToOptions | number, arg2?: number) {
    const top = typeof arg1 === "number" ? (arg2 ?? 0) : (arg1?.top ?? 0);
    this.scrollTop = top;
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute("role") === "log" ? 570 : 88;
    },
  });
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => serve(path));
});

describe("ChatPageView ?room=&message= deep link", () => {
  it("opens the DM at the file message and keeps it in view and highlighted after layout settles", async () => {
    latestDelayMs = 10;
    aroundDelayMs = 30;
    const nav = open("room=r-dm&message=m-dm");
    await expectHighlighted("m-dm");
    expect(nav.searchParams.toString()).toBe("room=r-dm");
    expect(screen.getAllByText("de-xuat.txt").length).toBeGreaterThan(0);
  });

  it("opens the channel at the file message and keeps it highlighted when around resolves on first paint", async () => {
    latestDelayMs = 40;
    aroundDelayMs = 10;
    const nav = open("room=r-ch&message=m-ch");
    await expectHighlighted("m-ch");
    expect(nav.searchParams.toString()).toBe("room=r-ch");
  });

  it.each(["dm", "ch"])("highlights through the web adapter, whose moves land later (%s)", async (kind) => {
    const nav = open(`room=r-${kind}&message=m-${kind}`, { async: true });
    await expectHighlighted(`m-${kind}`);
    await waitFor(() => expect(nav.searchParams.toString()).toBe(`room=r-${kind}`));
  });

  it.each(["dm", "ch"])("highlights when the rooms are already cached (%s)", async (kind) => {
    open(`room=r-${kind}&message=m-${kind}`, { async: true, cached: true });
    await expectHighlighted(`m-${kind}`);
  });

  it("keeps the highlight when a cached room refreshes its timeline with a newer own message on open", async () => {
    let latestCalls = 0;
    const base = TIMELINES["r-dm"]!.latest;
    const withNewerOwn = [...base, textMessage("r-dm", "r-dm-a30", reader.id, 45)];
    requestMock.mockImplementation((path: string) => {
      if (path.split("?")[0]?.endsWith("/chat/rooms/r-dm/messages")) {
        latestCalls += 1;
        return later({ messages: latestCalls === 1 ? base : withNewerOwn }, latestCalls === 1 ? 0 : 80);
      }
      return serve(path);
    });
    function AfterRoomAndTimelineCached({ children }: { children: React.ReactNode }) {
      const rooms = useChatRooms(WS);
      const messages = useChatRoomMessages(WS, "r-dm");
      const [ready, setReady] = useState(false);
      if (rooms.isSuccess && messages.isSuccess && !ready) setReady(true);
      return ready ? children : null;
    }
    aroundDelayMs = 5;
    const nav = fakeNav("/acme/team/chat?room=r-dm&message=m-dm");
    render(
      wrapWithNav(
        <AfterRoomAndTimelineCached>
          <ChatPageView workspaceId={WS} currentUserId={reader.id} />
        </AfterRoomAndTimelineCached>,
        nav,
      ),
    );
    await expectHighlighted("m-dm");
  });

  it.each(["dm", "ch"])("highlights when the reader joins the workspace room on open (%s)", async (kind) => {
    joined = false;
    open(`room=r-${kind}&message=m-${kind}`, { async: true });
    await expectHighlighted(`m-${kind}`);
  });

  it("never shows the around banner when the anchor window fails to load, pins the newest row, and lets a later scroll leave the bottom", async () => {
    aroundFails = true;
    open("room=r-dm&message=m-dm");
    await flushFramesAndObservers();
    expect(screen.queryByText("Đang xem vị trí tin nhắn đã tìm")).toBeNull();
    expect(document.getElementById("chat-msg-r-dm-a29")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Về tin mới nhất" })).toBeNull();

    act(() => {
      screen.getByRole("log").scrollTop = 500;
    });
    expect(screen.getByRole("button", { name: "Về tin mới nhất" })).toBeInTheDocument();
  });

  it("resets programmaticScrollRef when stickToBottomRef turns false while pinChatScrollToBottom is in flight", async () => {
    const scrollEl = document.createElement("div");
    const stickRef = { current: true };
    const programmaticRef = { current: false };
    pinChatScrollToBottom(scrollEl, stickRef, programmaticRef);
    expect(programmaticRef.current).toBe(true);
    stickRef.current = false;
    await later(null, 40);
    expect(programmaticRef.current).toBe(false);
  });

  it("toasts jump_failed once and pins the newest row when around returns an empty list", async () => {
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    aroundEmpty = true;
    open("room=r-dm&message=m-dm");
    await flushFramesAndObservers();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Không mở được tin nhắn được trích dẫn.");
    expect(screen.queryByText("Đang xem vị trí tin nhắn đã tìm")).toBeNull();
    expect(document.getElementById("chat-msg-r-dm-a29")).not.toBeNull();
  });

  it("leaves the anchor window and shows the sent row at the bottom on an own send while anchored", async () => {
    open("room=r-dm&message=m-dm");
    await expectHighlighted("m-dm");
    expect(screen.getByText("Đang xem vị trí tin nhắn đã tìm")).toBeInTheDocument();
    expect(document.getElementById("chat-msg-r-dm-a29")).toBeNull();

    act(() => {
      usePendingChatMessagesStore.getState().upsert({
        workspaceId: WS,
        roomId: "r-dm",
        client_msg_id: "c-own-1",
        body: "Tin mới của tôi",
        senderId: reader.id,
        createdAt: Date.UTC(2026, 9, 16, 5, 1, 0),
        status: "sending",
      });
    });
    await flushFramesAndObservers();

    expect(screen.queryByText("Đang xem vị trí tin nhắn đã tìm")).toBeNull();
    expect(document.getElementById("chat-msg-pending:c-own-1")).not.toBeNull();
    expect(screen.getByText("Tin mới của tôi")).toBeInTheDocument();
  });

  it("pins the newest row into view when clicking 'Về tin mới nhất'", async () => {
    open("room=r-dm&message=m-dm");
    await expectHighlighted("m-dm");
    expect(document.getElementById("chat-msg-r-dm-a29")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Về tin mới nhất" }));
    await flushFramesAndObservers();

    expect(screen.queryByText("Đang xem vị trí tin nhắn đã tìm")).toBeNull();
    expect(document.getElementById("chat-msg-r-dm-a29")).not.toBeNull();
  });

  it("clears the highlight after the fallback timeout when the anchor target is missing from the around rows, restoring the bottom pin", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      open("room=r-dm&message=m-missing");
      expect(await screen.findByText("Đang xem vị trí tin nhắn đã tìm")).toBeInTheDocument();
      await flushFramesAndObservers();

      const log = screen.getByRole("log");
      act(() => {
        log.scrollTop = 2900;
      });
      expect(log.scrollTop).toBe(2900);

      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(log.scrollTop).toBe(2900);

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(log.scrollTop).toBe(2950);
    } finally {
      vi.useRealTimers();
    }
  });
});
