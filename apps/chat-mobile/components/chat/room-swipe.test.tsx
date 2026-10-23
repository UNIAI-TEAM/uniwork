// The inbox row's swipe (room-swipe.tsx): right past the threshold marks the
// room read, left reveals its buttons and holds them open, a tap on the open
// row or a button closes it, and a recycled cell starts closed.
import "react-native-gesture-handler/jestSetup";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Text } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { ROOM_SWIPE_BUTTON, ROOM_SWIPE_FLICK, ROOM_SWIPE_READ } from "@/lib/room-swipe";
import { render } from "@/test/render";
import { RoomSwipe, type RoomSwipeButton } from "./room-swipe";

const swipe = async (translationX: number, velocityX = 0) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId("room-swipe"), [
      { state: State.BEGAN, translationX: 0, velocityX: 0 },
      { state: State.ACTIVE, translationX: translationX / 2, velocityX },
      { state: State.ACTIVE, translationX, velocityX },
      { state: State.END, translationX, velocityX },
    ] as never);
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
};

const buttons = (pin = jest.fn(), mute = jest.fn()): RoomSwipeButton[] => [
  { key: "pin", label: "Ghim", icon: "pin-outline", tone: "orange", onPress: pin },
  { key: "mute", label: "Tắt tiếng", icon: "notifications-off", tone: "gray", onPress: mute },
];

async function draw(extra: { onRead?: () => void; buttons?: RoomSwipeButton[]; onOpen?: jest.Mock; rowKey?: string } = {}) {
  const onOpen = extra.onOpen ?? jest.fn();
  const view = await render(
    <RoomSwipe rowKey={extra.rowKey ?? "dm:u2"} onRead={extra.onRead} readLabel="Đã đọc" buttons={extra.buttons ?? buttons()} onOpen={onOpen}>
      <Text>Bình</Text>
    </RoomSwipe>,
  );
  // Let the threshold reaction see the row at rest first: it ticks on a change from not armed to armed, and on a
  // loaded runner its first run could otherwise land after the whole drag (no "before"), which made the tick flaky.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { ...view, onOpen };
}

beforeEach(() => jest.clearAllMocks());

describe("RoomSwipe", () => {
  it("draws the row alone when it has nothing to swipe to", async () => {
    await render(
      <RoomSwipe rowKey="dm:u9" readLabel="Đã đọc" buttons={[]} onOpen={jest.fn()}>
        <Text>Chi</Text>
      </RoomSwipe>,
    );
    expect(screen.getByText("Chi")).toBeOnTheScreen();
    expect(() => getByGestureTestId("room-swipe")).toThrow();
  });

  it("marks the room read when a rightward drag lets go past the threshold, with a tick, and not from a short one", async () => {
    const onRead = jest.fn();
    await draw({ onRead });
    // At rest, no pane is mounted behind the row.
    expect(screen.queryByTestId("room-swipe-actions", { includeHiddenElements: true })).toBeNull();
    await swipe(ROOM_SWIPE_READ / 2);
    expect(onRead).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    await swipe(ROOM_SWIPE_READ + 30);
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it("reveals the buttons on a leftward drag past half their width, holds them open, and runs one on a tap", async () => {
    const pin = jest.fn();
    const { onOpen } = await draw({ buttons: buttons(pin) });
    await swipe(-ROOM_SWIPE_BUTTON * 1.5);
    expect(onOpen).toHaveBeenCalledWith(expect.any(Function));
    // The tick as the drag crossed half the buttons' width (jest-expo runs as iOS: a selection feel).
    await waitFor(() => expect(Haptics.selectionAsync).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId("room-swipe-pin", { includeHiddenElements: true }));
    expect(pin).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("room-swipe-close", { includeHiddenElements: true })).toBeNull();
  });

  it("opens on a flick, and a tap on the open row closes it instead of opening the room", async () => {
    const { onOpen } = await draw();
    await swipe(-20, -(ROOM_SWIPE_FLICK + 100));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("room-swipe-close", { includeHiddenElements: true }));
    expect(screen.queryByTestId("room-swipe-close", { includeHiddenElements: true })).toBeNull();
  });

  it("closes from a short drag, and the list can close an open row", async () => {
    const { onOpen } = await draw();
    await swipe(-20);
    expect(onOpen).not.toHaveBeenCalled();
    await swipe(-ROOM_SWIPE_BUTTON * 2);
    const close = onOpen.mock.calls[0]?.[0] as () => void;
    await act(async () => close());
    expect(screen.queryByTestId("room-swipe-close", { includeHiddenElements: true })).toBeNull();
  });

  it("starts closed when the recycled cell draws another room", async () => {
    const onOpen = jest.fn();
    const { rerender } = await draw({ onOpen });
    await swipe(-ROOM_SWIPE_BUTTON * 2);
    expect(screen.getByTestId("room-swipe-close", { includeHiddenElements: true })).toBeTruthy();
    await rerender(
      <RoomSwipe rowKey="group:g1" readLabel="Đã đọc" buttons={buttons()} onOpen={onOpen}>
        <Text>Thiết kế</Text>
      </RoomSwipe>,
    );
    expect(screen.queryByTestId("room-swipe-close", { includeHiddenElements: true })).toBeNull();
  });
});
