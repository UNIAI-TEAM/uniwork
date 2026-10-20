import { describe, expect, it } from "vitest";
import { useActiveChatRoomStore } from "./chat-active-room-store";

describe("active chat room store", () => {
  it("holds the room on screen, or none", () => {
    expect(useActiveChatRoomStore.getState().roomId).toBeNull();
    useActiveChatRoomStore.getState().setRoomId("r1");
    expect(useActiveChatRoomStore.getState().roomId).toBe("r1");
    useActiveChatRoomStore.getState().setRoomId(null);
    expect(useActiveChatRoomStore.getState().roomId).toBeNull();
  });
});
