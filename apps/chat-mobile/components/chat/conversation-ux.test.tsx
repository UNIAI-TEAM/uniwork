// A conversation as it feels and sounds (UNI-2053 S6; audit U2, P2 UX): a
// send is felt and lands in view, a long press and a reaction are felt, a
// reader scrolled up gets "N new" to jump back down, and a screen reader hears
// what someone else just sent.
// The photo viewer's pager and zoom run on the gesture runtime.
import "react-native-gesture-handler/jestSetup";
import { ChatMessageSchema, ChatRoomSchema, type ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { AccessibilityInfo, FlatList } from "react-native";
import { chatApi } from "@/data/chat-api";
import * as chatSend from "@/data/chat-send";
import * as pendingOps from "@/data/pending-ops";
import { toTimelineMessage, type TimelineMessage } from "@/lib/timeline-display";
import { render, viText } from "@/test/render";
import { Conversation } from "./conversation";
import { ARRIVAL_QUIET_MS } from "./use-arrival-announcements";
import type { ChatWorkspace } from "./use-chat-workspace";
import { useRoomContext } from "./use-room-context";

jest.mock("./connection-banner", () => ({ ConnectionBanner: () => null }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("./swipe-to-reply", () => ({ SwipeToReply: ({ children }: { children: ReactNode }) => children }));
jest.mock("./use-voice-recorder", () => ({
  VOICE_MAX_MS: 120_000,
  useVoiceRecorder: () => ({ active: false, elapsedMs: 0, start: jest.fn(), cancel: jest.fn(), send: jest.fn() }),
}));

const chat: ChatWorkspace = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "ME" };
const T0 = Date.UTC(2026, 9, 21, 2, 0);

const record = (id: string, sender: string, minute: number, body = `message ${id}`) =>
  ChatMessageSchema.parse({ id, room_id: "r1", workspace_id: "w1", sender_id: sender, sender_display_name: sender === "U2" ? "Bình" : sender, kind: "text", body, created_at: new Date(T0 + minute * 60_000).toISOString() });

const history = Array.from({ length: 6 }, (_, i) => record(`m0${i}`, i % 2 ? "ME" : "U2", i * 10));

function Screen({ records, onJumpToLatest }: { records: ChatMessageRecord[]; onJumpToLatest?: () => void }) {
  const room = useRoomContext(chat, "r1");
  const messages: TimelineMessage[] = records.map(toTimelineMessage);
  return (
    <Conversation
      chat={chat}
      roomId="r1"
      room={room}
      header={null}
      messages={messages}
      loading={false}
      loadingOlder={false}
      jumpTo={null}
      onQuoteJump={jest.fn()}
      onAtLatestChange={jest.fn()}
      onJumpToLatest={onJumpToLatest}
    />
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const scrollTo = async (y: number) => fireEvent.scroll(screen.getByTestId("message-list"), { nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 390, height: 3000 }, layoutMeasurement: { width: 390, height: 700 } } });

let scrollToOffset: jest.SpyInstance;

beforeEach(() => {
  const group = ChatRoomSchema.parse({ id: "r1", kind: "group", name: "Thiết kế", workspace_id: "w1", member_count: 2, member_user_ids: ["ME", "U2"] });
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([group]);
  jest.spyOn(chatApi, "listRoomMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listNicknames").mockResolvedValue({});
  jest.spyOn(chatApi, "listWorkspaceMembers").mockResolvedValue([]);
  jest.spyOn(chatApi, "listFollowUps").mockResolvedValue([]);
  jest.spyOn(chatApi, "listRoomMessageLinks").mockResolvedValue([]);
  jest.spyOn(chatSend, "sendChatMessage").mockResolvedValue(undefined as never);
  jest.spyOn(pendingOps, "toggleReaction").mockResolvedValue(undefined as never);
  scrollToOffset = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => undefined);
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());

describe("Conversation feel", () => {
  it("feels a send and scrolls it into view, wherever the reader was", async () => {
    await render(<Screen records={history} />);
    await settle();
    await fireEvent.changeText(screen.getByTestId("composer-input"), "Chào cả nhà");
    await fireEvent.press(screen.getByTestId("composer-send"));
    expect(chatSend.sendChatMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body: "Chào cả nhà", roomId: "r1" }), expect.anything());
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it("feels a long press that opens a message's actions and a reaction", async () => {
    await render(<Screen records={[...history, { ...record("m10", "U2", 100), reactions: { "👍": 1 } }]} />);
    await settle();
    const bubble = screen.getByLabelText(new RegExp(`message m10$`));
    await fireEvent(bubble, "longPress");
    expect(Haptics.impactAsync).toHaveBeenCalledWith("medium");
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.message_list.reaction_aria", { emoji: "👍", count: 1 }) }));
    expect(Haptics.selectionAsync).toHaveBeenCalled();
    expect(pendingOps.toggleReaction).toHaveBeenCalledWith(expect.anything(), "w1", "r1", "m10", "👍", "ME");
  });
});

describe("the photo viewer", () => {
  const photo = (id: string, minute: number) =>
    ChatMessageSchema.parse({
      id,
      room_id: "r1",
      workspace_id: "w1",
      sender_id: "U2",
      sender_display_name: "Bình",
      kind: "file",
      body: "",
      created_at: new Date(T0 + minute * 60_000).toISOString(),
      file: { id: `f-${id}`, filename: `${id}.jpg`, content_type: "image/jpeg", size_bytes: 1, url: `https://x/${id}.jpg`, url_expires_at: "2099-01-01T00:00:00Z" },
    });

  it("pages through every photo of the conversation once a photo opens it", async () => {
    // The opened page renews its URL with the room's other asks: no network in a test.
    jest.spyOn(chatApi, "getMessage").mockResolvedValue(null);
    // Ten minutes apart: two photos of their own, not one album.
    await render(<Screen records={[...history, photo("p1", 100), record("m20", "ME", 105), photo("p2", 110)]} />);
    await settle();
    expect(screen.queryByText(viText("chat.image_viewer_position", { current: 1, total: 2 }))).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByRole("imagebutton", { name: viText("chat.message_list.file_open_named", { name: "p1.jpg" }) }));
    });
    expect(await screen.findByText(viText("chat.image_viewer_position", { current: 1, total: 2 }))).toBeOnTheScreen();
  });
});

describe("jump to latest", () => {
  it("appears once the reader scrolls up, counts what others sent since, and takes them back down", async () => {
    const { rerender } = await render(<Screen records={history} />);
    await settle();
    expect(screen.queryByTestId("jump-to-latest")).toBeNull();

    await scrollTo(800);
    expect(screen.getByRole("button", { name: viText("chat.search_back_to_latest") })).toBeOnTheScreen();

    // Two from Bình and one of mine (from another device) arrive while the reader is up there.
    await rerender(<Screen records={[...history, record("m10", "U2", 100), record("m11", "ME", 101), record("m12", "U2", 102)]} />);
    await settle();
    const jump = screen.getByRole("button", { name: viText("chat.jump_latest_new", { count: 2 }) });
    expect(screen.getByText("2")).toBeOnTheScreen();

    await fireEvent.press(jump);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    await scrollTo(0);
    expect(screen.queryByTestId("jump-to-latest")).toBeNull();
  });

  it("caps the badge at 99+ and stays while the room shows an older page, going back to the latest", async () => {
    const onJumpToLatest = jest.fn();
    const many = Array.from({ length: 120 }, (_, i) => record(`n${String(i).padStart(3, "0")}`, "U2", 200 + i));
    const { rerender } = await render(<Screen records={history} onJumpToLatest={onJumpToLatest} />);
    await settle();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.search_back_to_latest") }));
    expect(onJumpToLatest).toHaveBeenCalledTimes(1);

    await scrollTo(800);
    await rerender(<Screen records={[...history, ...many]} onJumpToLatest={onJumpToLatest} />);
    await settle();
    expect(screen.getByRole("button", { name: viText("chat.jump_latest_new", { count: 120 }) })).toBeOnTheScreen();
    expect(screen.getByText("99+")).toBeOnTheScreen();
  });
});

describe("new messages and a screen reader", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  });
  afterEach(() => jest.useRealTimers());

  const flush = async () => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60);
    });
  };

  it("reads who wrote what, then gathers a burst into one count", async () => {
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { rerender } = await render(<Screen records={history} />);
    await flush();
    expect(announce).not.toHaveBeenCalled();

    await rerender(<Screen records={[...history, record("m10", "U2", 100, "Mai họp nhé")]} />);
    await flush();
    expect(announce).toHaveBeenLastCalledWith(viText("chat.message_list.live_new_message", { sender: "Bình", preview: "Mai họp nhé" }));

    await rerender(<Screen records={[...history, record("m10", "U2", 100, "Mai họp nhé"), record("m11", "U2", 101), record("m12", "U2", 102)]} />);
    await flush();
    expect(announce).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ARRIVAL_QUIET_MS);
    });
    expect(announce).toHaveBeenLastCalledWith(viText("mobile.a11y.new_messages", { count: 2 }));
  });

  it("stays quiet without a screen reader, and never reads one's own send", async () => {
    const reader = jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    const { rerender, unmount } = await render(<Screen records={history} />);
    await flush();
    await rerender(<Screen records={[...history, record("m10", "U2", 100)]} />);
    await flush();
    expect(announce).not.toHaveBeenCalled();
    await unmount();

    reader.mockResolvedValue(true);
    const again = await render(<Screen records={history} />);
    await flush();
    await again.rerender(<Screen records={[...history, record("m10", "ME", 100)]} />);
    await flush();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("a link in a message", () => {
  it("opens on a tap, and a long press offers open, copy and share, felt", async () => {
    const WebBrowser = jest.requireMock<{ openBrowserAsync: jest.Mock }>("expo-web-browser");
    await render(<Screen records={[...history, record("m10", "U2", 100, "Tài liệu: https://docs.example.com/plan")]} />);
    await settle();
    const link = screen.getByRole("link", { name: viText("mobile.conversation.link_label", { link: "docs.example.com/plan" }) });
    await fireEvent.press(link);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://docs.example.com/plan");
    await fireEvent(link, "longPress");
    expect(Haptics.impactAsync).toHaveBeenCalledWith("medium");
    expect(screen.getByRole("button", { name: viText("mobile.conversation.link_copy") })).toBeOnTheScreen();
  });
});
