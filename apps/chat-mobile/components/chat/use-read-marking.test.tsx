// When a room counts as read (use-read-marking.ts): on opening and on leaving it, and while it is in front, once a
// newer message has stayed at the bottom for 1.5 s; never for a reader scrolled up, behind a thread, or with the app
// in the background. And which room is "on screen": a thread over its room keeps its own when the room lets go.
import { act, renderHook } from "@testing-library/react-native";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { useActiveChatRoomStore } from "@/data/stores/chat-active-room-store";
import { useActiveRoom, useRoomReadMarking } from "./use-read-marking";

// The auth store's query client reads NetInfo; its native module is not in Jest.
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
const mockMarkRoomRead = jest.fn();
jest.mock("@/data/mutations/messages", () => ({ useMarkRoomRead: () => mockMarkRoomRead }));

// expo-router's focus, which test/jest-setup.ts's router mock does not have: a screen is focused while `focused` is.
let focused = true;
const router = jest.requireMock<Record<string, unknown>>("expo-router");
router.useIsFocused = () => focused;
function useFakeFocusEffect(effect: () => void | (() => void)) {
  const now = focused;
  useEffect(() => {
    return now ? effect() : undefined;
  }, [effect, now]);
}
router.useFocusEffect = useFakeFocusEffect;

let appStateChange: (status: AppStateStatus) => void = () => undefined;
const removeAppState = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  focused = true;
  useAuthStore.setState({ user: { id: "ME" } as never });
  useActiveChatRoomStore.setState({ roomId: null });
  // React Native's Jest preset makes currentState a mock function; the hook reads the string.
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateChange = listener as (status: AppStateStatus) => void;
    return { remove: removeAppState };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

interface Props {
  newest: string | null;
  atLatest: boolean;
  roomId?: string;
}

const mount = (props: Props) =>
  renderHook(({ newest, atLatest, roomId = "r1" }: Props) => useRoomReadMarking("w1", roomId, newest, atLatest), { initialProps: props });

describe("useRoomReadMarking", () => {
  it("marks the room read on opening and on leaving, and makes it the room on screen meanwhile", async () => {
    const { unmount } = await mount({ newest: "m1", atLatest: true });
    expect(mockMarkRoomRead).toHaveBeenCalledWith("w1", "r1", "ME");
    expect(useActiveChatRoomStore.getState().roomId).toBe("r1");
    await act(async () => unmount());
    expect(mockMarkRoomRead).toHaveBeenCalledTimes(2);
    expect(useActiveChatRoomStore.getState().roomId).toBeNull();
    expect(removeAppState).toHaveBeenCalledTimes(1);
  });

  it("marks a newer message read once it has stayed at the bottom for 1.5 s", async () => {
    jest.useFakeTimers();
    const view = await mount({ newest: "m1", atLatest: true });
    mockMarkRoomRead.mockClear();
    await view.rerender({ newest: "m2", atLatest: true });
    await act(async () => jest.advanceTimersByTime(1_499));
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(mockMarkRoomRead).toHaveBeenCalledWith("w1", "r1", "ME");
    // The same newest message again is not marked twice.
    mockMarkRoomRead.mockClear();
    await view.rerender({ newest: "m2", atLatest: true });
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
  });

  it("does not mark a newer message for a reader scrolled up, nor one that moved on within 1.5 s", async () => {
    jest.useFakeTimers();
    const view = await mount({ newest: "m1", atLatest: true });
    mockMarkRoomRead.mockClear();
    await view.rerender({ newest: "m2", atLatest: false });
    await act(async () => jest.advanceTimersByTime(2_000));
    await view.rerender({ newest: "m3", atLatest: true });
    await act(async () => jest.advanceTimersByTime(1_000));
    await view.rerender({ newest: "m3", atLatest: false });
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
  });

  it("does not mark while the app is in the background", async () => {
    jest.useFakeTimers();
    const view = await mount({ newest: "m1", atLatest: true });
    mockMarkRoomRead.mockClear();
    await act(async () => appStateChange("background"));
    await view.rerender({ newest: "m2", atLatest: true });
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
    // Back in front with that message at the bottom: it counts.
    await act(async () => appStateChange("active"));
    await act(async () => jest.advanceTimersByTime(1_500));
    expect(mockMarkRoomRead).toHaveBeenCalledTimes(1);
  });

  it("treats a room under a thread as not in front, and a room switch's first message as already read", async () => {
    jest.useFakeTimers();
    focused = false;
    const view = await mount({ newest: "m1", atLatest: true });
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
    await view.rerender({ newest: "m2", atLatest: true });
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
    // Another room in the same screen: opening it marks it, its first newest message is not marked again.
    focused = true;
    await view.rerender({ newest: "x1", atLatest: true, roomId: "r2" });
    expect(mockMarkRoomRead).toHaveBeenCalledTimes(1);
    expect(mockMarkRoomRead).toHaveBeenCalledWith("w1", "r2", "ME");
    await act(async () => jest.advanceTimersByTime(2_000));
    expect(mockMarkRoomRead).toHaveBeenCalledTimes(1);
  });

  it("marks nothing signed out or before the room has a message", async () => {
    jest.useFakeTimers();
    useAuthStore.setState({ user: null });
    const view = await mount({ newest: null, atLatest: true });
    await view.rerender({ newest: "m1", atLatest: true });
    await view.rerender({ newest: "m2", atLatest: true });
    await act(async () => jest.advanceTimersByTime(2_000));
    await act(async () => view.unmount());
    expect(mockMarkRoomRead).not.toHaveBeenCalled();
  });
});

describe("useActiveRoom", () => {
  it("keeps a thread's room on screen when the room under it lets go", async () => {
    const onFocus = jest.fn();
    const room = await renderHook(() => useActiveRoom("r1"));
    const thread = await renderHook(() => useActiveRoom("r2", onFocus));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(useActiveChatRoomStore.getState().roomId).toBe("r2");
    await act(async () => room.unmount());
    expect(useActiveChatRoomStore.getState().roomId).toBe("r2");
    await act(async () => thread.unmount());
    expect(useActiveChatRoomStore.getState().roomId).toBeNull();
  });
});
