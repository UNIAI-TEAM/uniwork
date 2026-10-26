// The inbox's room commands (use-room-commands.ts) and the three ways in: the
// long-press menu's rows, each row's swipe and its screen-reader actions
// (room-list-view.tsx). Mark read only with something unread, mute only for a
// room that exists, pin for any room; one swiped row open at a time.
import { act, fireEvent, renderHook, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { useToastStore } from "@/data/stores/toast-store";
import { i18n } from "@/lib/i18n/singleton";
import type { RoomListRow } from "@/lib/room-list";
import { render, viText } from "@/test/render";
import { RoomListView } from "./room-list-view";
import type { RoomSwipeButton } from "./room-swipe";
import { roomCommandsFor, roomMenuActions, useRoomCommands, type RoomCommands } from "./use-room-commands";

const mockMarkRoomRead = jest.fn();
const mockSetMuted = jest.fn(async (_input: { roomId: string; muted: boolean }) => undefined);
jest.mock("@/data/mutations/messages", () => ({ useMarkRoomRead: () => mockMarkRoomRead }));
jest.mock("@/data/mutations/rooms", () => ({ useSetRoomMuted: () => ({ mutateAsync: mockSetMuted }) }));

// The gesture is room-swipe.test.tsx's; here a stand-in exposes what the list hands each row's swipe.
jest.mock("./room-swipe", () => ({
  RoomSwipe: (props: { rowKey: string; onRead?: () => void; buttons: RoomSwipeButton[]; onOpen: (close: () => void) => void; children: ReactNode }) => {
    const { Pressable, Text, View } = jest.requireActual<typeof import("react-native")>("react-native");
    return (
      <View testID={`swipe-${props.rowKey}`}>
        {props.onRead ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`read ${props.rowKey}`} onPress={props.onRead}>
            <Text>read</Text>
          </Pressable>
        ) : null}
        {props.buttons.map((button) => (
          <Pressable key={button.key} accessibilityRole="button" accessibilityLabel={`${button.label} ${props.rowKey}`} onPress={button.onPress}>
            <Text>{button.label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel={`open ${props.rowKey}`} onPress={() => props.onOpen(mockClose(props.rowKey))}>
          <Text>open</Text>
        </Pressable>
        {props.children}
      </View>
    );
  },
}));
const closes = new Map<string, jest.Mock>();
const mockClose = (key: string) => {
  const close = closes.get(key) ?? jest.fn();
  closes.set(key, close);
  return close;
};

const row = (extra: Partial<RoomListRow>): RoomListRow => ({
  key: "dm:u2",
  entry: { kind: "dm", key: "dm:u2" } as never,
  roomId: "dm2",
  room: { id: "dm2" } as never,
  title: "Bình",
  mark: { kind: "dm", label: "Bình", online: false, userId: "U2" },
  prefix: null,
  subtitle: "chào",
  typing: false,
  missed: false,
  seen: false,
  time: "09:41",
  unread: 2,
  mentionUnread: 0,
  muted: false,
  pinned: false,
  ...extra,
});

const commands = (): jest.Mocked<RoomCommands> => ({ markRead: jest.fn(), togglePin: jest.fn(), toggleMute: jest.fn() });
/** The app's i18n, so a hook's t() speaks Vietnamese as on a screen. */
const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
const chat = { wsId: "w1", orgSlug: "acme", wsSlug: "hq", workspaceName: "HQ", userId: "u1" };

beforeEach(() => {
  jest.clearAllMocks();
  closes.clear();
});
const realToggle = useChatPinsStore.getState().toggle;
// A toast arms its own dismissal timer: cleared, so Jest can exit. The pins store gets its own toggle back.
afterEach(() => {
  useToastStore.getState().clear();
  useChatPinsStore.setState({ toggle: realToggle });
});

describe("roomCommandsFor and roomMenuActions", () => {
  it("offers read only with something unread, mute only for a room that exists, pin for any room", () => {
    expect(roomCommandsFor(row({}))).toEqual({ read: true, pin: true, mute: true });
    expect(roomCommandsFor(row({ unread: 0, mentionUnread: 1 }))).toEqual({ read: true, pin: true, mute: true });
    expect(roomCommandsFor(row({ unread: 0 }))).toEqual({ read: false, pin: true, mute: true });
    expect(roomCommandsFor(row({ room: null }))).toEqual({ read: false, pin: true, mute: false });
    expect(roomCommandsFor(row({ roomId: null, room: null }))).toEqual({ read: false, pin: false, mute: false });
  });

  it("builds the menu's rows in that order, each running its command on the row", () => {
    const run = commands();
    const t = viText;
    expect(roomMenuActions(null, run, t)).toEqual([]);
    const actions = roomMenuActions(row({}), run, t);
    expect(actions.map((action) => action.label)).toEqual([
      viText("mobile.notification_actions.mark_read"),
      viText("chat.settings_pin_conversation"),
      viText("chat.settings_mute_notifications"),
    ]);
    for (const action of actions) action.onPress();
    expect(run.markRead).toHaveBeenCalledTimes(1);
    expect(run.togglePin).toHaveBeenCalledTimes(1);
    expect(run.toggleMute).toHaveBeenCalledTimes(1);
    const pinnedMuted = roomMenuActions(row({ unread: 0, pinned: true, muted: true }), run, t);
    expect(pinnedMuted.map((action) => [action.label, action.icon])).toEqual([
      [viText("chat.mobile.unpin_conversation"), "pin"],
      [viText("chat.mobile.unmute_notifications"), "notifications-outline"],
    ]);
  });
});

describe("useRoomCommands", () => {
  it("marks a room read for this person, pins it on the device and mutes it on the server", async () => {
    const toggle = jest.fn(async (_roomId: string) => undefined);
    useChatPinsStore.setState({ toggle });
    const { result } = await renderHook(() => useRoomCommands(chat), { wrapper });
    result.current.markRead(row({}));
    expect(mockMarkRoomRead).toHaveBeenCalledWith("w1", "dm2", "u1");
    result.current.togglePin(row({}));
    expect(toggle).toHaveBeenCalledWith("dm2");
    result.current.toggleMute(row({ muted: true }));
    expect(mockSetMuted).toHaveBeenCalledWith({ roomId: "dm2", muted: false });
  });

  it("does nothing for a DM that has no room yet, or before the workspace is known", async () => {
    const toggle = jest.fn(async (_roomId: string) => undefined);
    useChatPinsStore.setState({ toggle });
    const { result } = await renderHook(() => useRoomCommands(chat), { wrapper });
    const none = row({ roomId: null, room: null });
    result.current.markRead(none);
    result.current.togglePin(none);
    result.current.toggleMute(none);
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    expect(mockSetMuted).not.toHaveBeenCalled();
    const early = await renderHook(() => useRoomCommands(null), { wrapper });
    early.result.current.markRead(row({}));
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
  });

  it("says so when the server refuses a mute", async () => {
    mockSetMuted.mockRejectedValueOnce(new Error("offline"));
    const { result } = await renderHook(() => useRoomCommands(chat), { wrapper });
    await act(async () => {
      result.current.toggleMute(row({}));
      await Promise.resolve();
    });
    expect(useToastStore.getState().toasts.at(-1)).toEqual(expect.objectContaining({ message: viText("common.error"), tone: "error" }));
  });
});

describe("RoomListView with commands", () => {
  const rows = [
    row({}),
    row({ key: "group:g1", roomId: "g1", room: { id: "g1" } as never, title: "Thiết kế", mark: { kind: "group", label: "Thiết kế" }, unread: 0, pinned: true, muted: true }),
    row({ key: "dm:u9", roomId: null, room: null, title: "Chi", unread: 0 }),
  ];
  const draw = (run?: RoomCommands) =>
    render(<RoomListView rows={rows} typingLines={{}} queuedRooms={new Set()} onOpen={jest.fn()} onMenu={jest.fn()} commands={run} />);

  it("names mark read, pin and mute to a screen reader ahead of the menu, and runs them on the newest row", async () => {
    const run = commands();
    await draw(run);
    const bình = screen.getByRole("button", { name: /^Bình/ });
    expect(bình.props.accessibilityActions).toEqual([
      { name: "mark_read", label: viText("mobile.notification_actions.mark_read") },
      { name: "pin", label: viText("chat.settings_pin_conversation") },
      { name: "mute", label: viText("chat.settings_mute_notifications") },
      { name: "longpress", label: viText("chat.settings_manage_room") },
    ]);
    for (const actionName of ["mark_read", "pin", "mute"]) await fireEvent(bình, "accessibilityAction", { nativeEvent: { actionName } });
    expect(run.markRead).toHaveBeenCalledWith(rows[0]);
    expect(run.togglePin).toHaveBeenCalledWith(rows[0]);
    expect(run.toggleMute).toHaveBeenCalledWith(rows[0]);
    // A pinned, muted room with nothing unread says unpin and unmute; a DM with no room has only the menu.
    expect(screen.getByRole("button", { name: /^Thiết kế/ }).props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual([
      viText("chat.mobile.unpin_conversation"),
      viText("chat.mobile.unmute_notifications"),
      viText("chat.settings_manage_room"),
    ]);
    expect(screen.queryByTestId("swipe-dm:u9")).toBeNull();
  });

  it("hands each row's swipe its commands: read when unread, then pin and mute with short labels", async () => {
    const run = commands();
    await draw(run);
    await fireEvent.press(screen.getByRole("button", { name: "read dm:u2" }));
    expect(run.markRead).toHaveBeenCalledWith(rows[0]);
    expect(screen.queryByRole("button", { name: "read group:g1" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: `${viText("chat.action_unpin")} group:g1` }));
    expect(run.togglePin).toHaveBeenCalledWith(rows[1]);
    await fireEvent.press(screen.getByRole("button", { name: `${viText("mobile.room_swipe.unmute")} group:g1` }));
    expect(run.toggleMute).toHaveBeenCalledWith(rows[1]);
    expect(screen.getByRole("button", { name: `${viText("mobile.room_swipe.mute")} dm:u2` })).toBeOnTheScreen();
  });

  it("keeps one row open: opening another closes the last, and a scroll closes it", async () => {
    await draw(commands());
    await fireEvent.press(screen.getByRole("button", { name: "open dm:u2" }));
    await fireEvent.press(screen.getByRole("button", { name: "open dm:u2" }));
    expect(closes.get("dm:u2")).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "open group:g1" }));
    expect(closes.get("dm:u2")).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId("room-list"), "scrollBeginDrag");
    expect(closes.get("group:g1")).toHaveBeenCalledTimes(1);
  });

  it("draws plain rows without the commands", async () => {
    await draw();
    expect(screen.queryByTestId("swipe-dm:u2")).toBeNull();
    expect(screen.getByRole("button", { name: /^Bình/ }).props.accessibilityActions).toEqual([
      { name: "longpress", label: viText("chat.settings_manage_room") },
    ]);
  });
});
