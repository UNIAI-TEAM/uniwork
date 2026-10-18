import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => void store.set(key, value)),
}));

import { useChatPinsStore } from "./chat-pins-store";

beforeEach(() => {
  store.clear();
  useChatPinsStore.setState({ wsId: null, byRoomId: {} });
});

describe("chat pins store", () => {
  it("pins and unpins a room on this device, per workspace", async () => {
    const pins = useChatPinsStore.getState();
    await pins.toggle("r1");
    expect(useChatPinsStore.getState().byRoomId).toEqual({});

    await pins.load("w1");
    await useChatPinsStore.getState().toggle("r1", 100);
    await useChatPinsStore.getState().toggle("r2", 200);
    expect(useChatPinsStore.getState().byRoomId).toEqual({ r1: { pinned: true, pinnedAt: 100 }, r2: { pinned: true, pinnedAt: 200 } });
    expect(JSON.parse(store.get("uniwork_chat_pins_w1") ?? "null")).toEqual({ r1: 100, r2: 200 });

    await useChatPinsStore.getState().toggle("r1");
    expect(JSON.parse(store.get("uniwork_chat_pins_w1") ?? "null")).toEqual({ r2: 200 });

    await useChatPinsStore.getState().load("w2");
    expect(useChatPinsStore.getState()).toMatchObject({ wsId: "w2", byRoomId: {} });
    await useChatPinsStore.getState().load("w1");
    expect(useChatPinsStore.getState().byRoomId).toEqual({ r2: { pinned: true, pinnedAt: 200 } });
    // Loading the same workspace again keeps its pins on screen while it reads.
    const again = useChatPinsStore.getState().load("w1");
    expect(useChatPinsStore.getState().byRoomId).toEqual({ r2: { pinned: true, pinnedAt: 200 } });
    await again;
  });

  it("reads garbage as no pins, and drops a load overtaken by a workspace switch", async () => {
    for (const raw of ["not json", "[1]", "null", JSON.stringify({ r1: "x", r2: 5 })]) {
      store.set("uniwork_chat_pins_w1", raw);
      useChatPinsStore.setState({ wsId: null, byRoomId: {} });
      await useChatPinsStore.getState().load("w1");
    }
    expect(useChatPinsStore.getState().byRoomId).toEqual({ r2: { pinned: true, pinnedAt: 5 } });

    const slow = useChatPinsStore.getState().load("w3");
    useChatPinsStore.setState({ wsId: "w4" });
    await slow;
    expect(useChatPinsStore.getState()).toMatchObject({ wsId: "w4" });
  });
});
