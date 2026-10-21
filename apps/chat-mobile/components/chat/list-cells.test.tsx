// The memoized cells of the two chat lists and what they read on their own:
// a message cell (bubble, swipe, thread root), a room list row (typing line,
// presence, taps that act on the newest row), and the header line that says
// who is typing.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { usePresenceStore } from "@/data/stores/chat-presence-store";
import { useSidebarTypingStore } from "@/data/stores/chat-typing-store";
import type { MessageRowModel } from "@/lib/message-row-model";
import type { RoomListRow } from "@/lib/room-list";
import { toTimelineMessage } from "@/lib/timeline-display";
import { listAnchoring } from "@/test/list-anchoring";
import { render, viText } from "@/test/render";
import { MessageCell, type MessageHandlers } from "./message-cell";
import { RoomListView } from "./room-list-view";
import { ConversationTyping, RoomChatHeader } from "./room-typing";

// A swipe needs the gesture runtime; the stand-in is a button that "swipes".
jest.mock("./swipe-to-reply", () => ({
  SwipeToReply: ({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: ReactNode }) => {
    const { Pressable, Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return (
      <>
        {enabled ? (
          <Pressable accessibilityRole="button" accessibilityLabel="swipe" onPress={onReply}>
            <Text>swipe</Text>
          </Pressable>
        ) : null}
        {children}
      </>
    );
  },
}));

const message = toTimelineMessage(
  ChatMessageSchema.parse({ id: "m1", room_id: "r1", workspace_id: "w1", sender_id: "U2", sender_display_name: "Bình", kind: "text", body: "chào", created_at: "2026-10-21T02:00:00Z" }),
);

const model = (extra: Partial<MessageRowModel> = {}): MessageRowModel => ({
  key: "m1",
  message,
  own: false,
  compactTop: false,
  continued: false,
  senderName: "Bình",
  showSender: false,
  quote: null,
  receipt: null,
  avatar: "none",
  album: undefined,
  root: false,
  threadReplies: 0,
  highlighted: false,
  showThread: true,
  swipeToReply: true,
  taskIds: undefined,
  ...extra,
});

const handlers = (): MessageHandlers => ({
  onLongPress: jest.fn(),
  onPressQuote: jest.fn(),
  onPressThread: jest.fn(),
  onPressPending: jest.fn(),
  onToggleReaction: jest.fn(),
  onReply: jest.fn(),
});

const ctx = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", roomId: "r1", userId: "ME", onOpenImage: jest.fn(), onVotePoll: jest.fn(), onOpenLink: jest.fn(), onLinkMenu: jest.fn() };

afterEach(async () => {
  await act(async () => {
    useSidebarTypingStore.getState().clearAll();
    usePresenceStore.getState().clearAll();
  });
});

describe("MessageCell", () => {
  it("quotes its message in the composer on a swipe, and draws a face or a spacer beside a group's bubble", async () => {
    const h = handlers();
    const { rerender } = await render(<MessageCell model={model({ avatar: "face" })} ctx={ctx} scheme="light" handlers={h} />);
    await fireEvent.press(screen.getByRole("button", { name: "swipe" }));
    expect(h.onReply).toHaveBeenCalledWith(message);
    // The face is decorative (the bubble reads the name): found among hidden elements.
    expect(screen.getByText("B", { includeHiddenElements: true })).toBeOnTheScreen();
    await rerender(<MessageCell model={model({ avatar: "spacer", swipeToReply: false })} ctx={ctx} scheme="light" handlers={h} />);
    expect(screen.queryByText("B", { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByRole("button", { name: "swipe" })).toBeNull();
  });

  it("stands a thread's root above its replies' divider, and without one before any reply", async () => {
    const { rerender } = await render(<MessageCell model={model({ root: true, threadReplies: 2 })} ctx={ctx} scheme="dark" handlers={handlers()} />);
    expect(screen.getByRole("header", { name: viText("chat.thread_replies", { count: 2 }) })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "swipe" })).toBeNull();
    await rerender(<MessageCell model={model({ root: true, threadReplies: 0 })} ctx={ctx} scheme="dark" handlers={handlers()} />);
    expect(screen.queryByRole("header")).toBeNull();
  });
});

const row = (extra: Partial<RoomListRow>): RoomListRow => ({
  key: "dm:u2",
  entry: { kind: "dm", key: "dm:u2" } as never,
  roomId: "dm2",
  room: null,
  title: "Bình",
  mark: { kind: "dm", label: "Bình", online: false, userId: "U2" },
  prefix: null,
  subtitle: "chào",
  typing: false,
  missed: false,
  seen: false,
  time: "09:41",
  unread: 0,
  mentionUnread: 0,
  muted: false,
  pinned: false,
  ...extra,
});

const rows = [
  row({}),
  row({ key: "group:g1", roomId: "g1", title: "Thiết kế", mark: { kind: "group", label: "Thiết kế" }, prefix: "An: ", subtitle: "ok", missed: true }),
  row({ key: "channel:c1", roomId: "c1", title: "#dev", mark: { kind: "channel" }, subtitle: null }),
  // A DM with nobody yet: no room to name its test id after.
  row({ key: "dm:u9", roomId: null, title: "Chi", mark: { kind: "dm", label: "Chi", online: false, userId: "U9" }, subtitle: null }),
];

const rowLabel = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("RoomListView", () => {
  it("lays the typing line over a row, marks a queued room and a present person", async () => {
    await render(<RoomListView rows={rows} typingLines={{ g1: "Chi đang nhập…" }} queuedRooms={new Set(["c1"])} onOpen={jest.fn()} onMenu={jest.fn()} />);
    expect(screen.getByText("Chi đang nhập…")).toBeOnTheScreen();
    expect(screen.queryByText("An: ")).toBeNull();
    expect(screen.getByText(viText("chat.mobile.send_queued"))).toBeOnTheScreen();
    expect(screen.getByTestId("room-row-dm2")).toBeOnTheScreen();
    await act(async () => usePresenceStore.getState().bump("u2", "ME"));
    expect(screen.getByText("Bình")).toBeOnTheScreen();
  });

  it("opens and manages the newest row with the key the tapped cell drew", async () => {
    const onOpen = jest.fn();
    const onMenu = jest.fn();
    const { rerender } = await render(<RoomListView rows={rows} typingLines={{}} queuedRooms={new Set()} onOpen={onOpen} onMenu={onMenu} />);
    // The same drawing, a newer record: the cell is skipped, the tap still gets the newer row.
    const newer = rows.map((r) => (r.key === "dm:u2" ? { ...r, room: { id: "dm2" } as never } : r));
    await rerender(<RoomListView rows={newer} typingLines={{}} queuedRooms={new Set()} onOpen={onOpen} onMenu={onMenu} />);
    await fireEvent.press(rowLabel("Bình"));
    expect(onOpen).toHaveBeenCalledWith(newer[0]);
    await fireEvent(rowLabel("Chi"), "longPress");
    expect(onMenu).toHaveBeenCalledWith(newer[3]);
  });

  it("stays pinned to its top when a room moves up: no row is held in place above a new first row", async () => {
    // The inbox sorts by latest activity: a new message in the last room moves it to the top. FlashList 2 keeps the
    // old top row where it was by default, scrolling the list by a row so the room that moved sits above the screen.
    const five = ["a", "b", "c", "d", "e"].map((id) => row({ key: `group:${id}`, roomId: id, title: id.toUpperCase(), mark: { kind: "group", label: id } }));
    const props = { typingLines: {}, queuedRooms: new Set<string>(), onOpen: jest.fn(), onMenu: jest.fn() };
    const { rerender } = await render(<RoomListView rows={five} {...props} />);
    expect(listAnchoring(screen.toJSON())).toEqual({ maintained: [], anchors: [] });
    const bumped = five.at(-1);
    await rerender(<RoomListView rows={[...(bumped ? [bumped] : []), ...five.slice(0, -1)]} {...props} />);
    expect(listAnchoring(screen.toJSON())).toEqual({ maintained: [], anchors: [] });
    expect(screen.getByTestId("room-row-e")).toBeOnTheScreen();
  });
});

describe("RoomChatHeader", () => {
  it("says who is typing, else that the peer is online, else nothing", async () => {
    const { rerender } = await render(<RoomChatHeader roomId="r1" nameContext={[{ user_id: "U2", display_name: "Bình" }]} online title="Bình" />);
    expect(screen.getByText(viText("chat.presence_online"))).toBeOnTheScreen();
    await act(async () => useSidebarTypingStore.getState().bump("r1", "U2", "ME"));
    expect(screen.getByText(viText("chat.typing_one", { name: "Bình" }))).toBeOnTheScreen();
    await act(async () => useSidebarTypingStore.getState().clearAll());
    await rerender(<RoomChatHeader roomId="r1" nameContext={[]} online={false} title="Bình" />);
    expect(screen.queryByText(viText("chat.presence_online"))).toBeNull();
  });
});

describe("ConversationTyping", () => {
  it("draws nothing while nobody types, then the bubble: with the typist's face in a group, alone in a DM", async () => {
    const people = [{ user_id: "U2", display_name: "Bình" }];
    const { rerender } = await render(<ConversationTyping roomId="r1" nameContext={people} isGroup />);
    expect(screen.queryByLabelText(viText("chat.typing_one", { name: "Bình" }))).toBeNull();
    await act(async () => useSidebarTypingStore.getState().bump("r1", "U2", "ME"));
    expect(screen.getByLabelText(viText("chat.typing_one", { name: "Bình" }))).toBeOnTheScreen();
    expect(screen.getByText("B", { includeHiddenElements: true })).toBeOnTheScreen();
    await rerender(<ConversationTyping roomId="r1" nameContext={people} isGroup={false} />);
    expect(screen.queryByText("B", { includeHiddenElements: true })).toBeNull();
  });
});
