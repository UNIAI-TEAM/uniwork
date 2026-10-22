import { describe, expect, it } from "vitest";
import { roomReadPushFromData } from "./room-read-push";

describe("roomReadPushFromData", () => {
  it("reads the room, its workspace and the icon's count the server sends", () => {
    expect(roomReadPushFromData({ type: "room_read", room_id: "r-1", workspace_id: "w-1", badge: "4" })).toEqual({
      roomId: "r-1",
      workspaceId: "w-1",
      badge: 4,
    });
  });

  it("has no count, or no workspace, when the push does not say", () => {
    expect(roomReadPushFromData({ type: "room_read", room_id: "r-1", badge: "-2" })).toEqual({ roomId: "r-1", workspaceId: "", badge: null });
    expect(roomReadPushFromData({ type: "room_read", room_id: "r-1", badge: 4 })?.badge).toBeNull();
  });

  it("is nothing for any other push or a room it cannot name", () => {
    expect(roomReadPushFromData({ type: "call_end", room_id: "r-1", call_id: "c" })).toBeNull();
    expect(roomReadPushFromData({ type: "room_read", room_id: "" })).toBeNull();
    expect(roomReadPushFromData({ type: "room_read" })).toBeNull();
    expect(roomReadPushFromData("room_read")).toBeNull();
  });
});
