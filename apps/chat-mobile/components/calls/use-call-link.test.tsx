// The call's link (use-call-link.ts) on a stand-in room: a drop is "reconnecting" until LiveKit has it back, in
// the ongoing notification too, and is counted recovered or not; a weak link is ours first, then anyone else's,
// and goes when it is good again.
import { act, renderHook } from "@testing-library/react-native";
import type { Room } from "livekit-client";
import { callLinkTracker } from "@/data/calls/call-link";
import { nativeCallSync } from "@/data/calls/call-wiring";
import { callEngine } from "@/data/calls/call-store";
import { useCallLink } from "./use-call-link";

jest.mock("livekit-client", () => ({
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor", Lost: "lost" },
  RoomEvent: {
    Reconnecting: "reconnecting",
    SignalReconnecting: "signalReconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
    ConnectionQualityChanged: "connectionQualityChanged",
  },
}));
jest.mock("@/data/calls/call-wiring", () => ({ nativeCallSync: { setReconnecting: jest.fn() } }));
jest.mock("@/data/calls/call-link", () => ({ callLinkTracker: { reconnecting: jest.fn(), reconnected: jest.fn(), disconnected: jest.fn() } }));

type Handler = (...args: unknown[]) => void;

function fakeRoom() {
  const handlers = new Map<string, Set<Handler>>();
  const room = {
    on: jest.fn((event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
    }),
    off: jest.fn((event: string, handler: Handler) => handlers.get(event)?.delete(handler)),
  };
  const emit = (event: string, ...args: unknown[]) => act(() => handlers.get(event)?.forEach((handler) => handler(...args)));
  return { emit, handlers, asRoom: room as unknown as Room };
}

const me = { isLocal: true, identity: "me" };
const an = { isLocal: false, identity: "an" };
const binh = { isLocal: false, identity: "binh" };

beforeEach(() => jest.clearAllMocks());

describe("useCallLink", () => {
  it("is reconnecting from a drop until LiveKit has the link back, in the notification too, and counts it", async () => {
    const f = fakeRoom();
    const { result } = await renderHook(() => useCallLink(f.asRoom));
    expect(result.current).toEqual({ reconnecting: false, weak: null });
    await f.emit("signalReconnecting");
    expect(result.current.reconnecting).toBe(true);
    expect(callLinkTracker.reconnecting).toHaveBeenCalledTimes(1);
    expect(nativeCallSync.setReconnecting).toHaveBeenLastCalledWith(true, callEngine.store.getState().call);
    await f.emit("reconnecting");
    await f.emit("reconnected");
    expect(result.current.reconnecting).toBe(false);
    expect(callLinkTracker.reconnected).toHaveBeenCalledTimes(1);
    expect(nativeCallSync.setReconnecting).toHaveBeenLastCalledWith(false, callEngine.store.getState().call);
    await f.emit("disconnected");
    expect(callLinkTracker.disconnected).toHaveBeenCalledTimes(1);
  });

  it("says whose link is weak — ours before anyone else's — and forgets it when it is good again", async () => {
    const f = fakeRoom();
    const { result } = await renderHook(() => useCallLink(f.asRoom));
    await f.emit("connectionQualityChanged", "poor", an);
    await f.emit("connectionQualityChanged", "lost", binh);
    expect(result.current.weak).toBe("peer");
    await f.emit("connectionQualityChanged", "poor", me);
    expect(result.current.weak).toBe("self");
    await f.emit("connectionQualityChanged", "good", me);
    await f.emit("connectionQualityChanged", "excellent", an);
    // The same news again changes nothing.
    await f.emit("connectionQualityChanged", "excellent", an);
    expect(result.current.weak).toBe("peer");
    await f.emit("connectionQualityChanged", "good", binh);
    expect(result.current.weak).toBeNull();
  });

  it("stops listening with the room", async () => {
    const f = fakeRoom();
    const view = await renderHook(() => useCallLink(f.asRoom));
    await view.unmount();
    for (const set of f.handlers.values()) expect(set.size).toBe(0);
  });
});
