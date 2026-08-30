import { describe, expect, it, vi } from "vitest";
import { canSendMatrixTyping, compareDmRoomScore, sendMatrixTyping } from "./matrix-dm";import { isServerMatrixEventId } from "./matrix-unread";

describe("isServerMatrixEventId", () => {
  it("accepts server event ids", () => {
    expect(isServerMatrixEventId("$abc:localhost")).toBe(true);
  });

  it("rejects local echo ids", () => {
    expect(isServerMatrixEventId("~!room:localhost:m123.0")).toBe(false);
  });
});

describe("compareDmRoomScore", () => {
  it("prefers the room with more messages", () => {
    const busy = { messageCount: 5, bothJoined: true, membershipRank: 2, roomId: "!b:localhost" };
    const quiet = { messageCount: 1, bothJoined: true, membershipRank: 2, roomId: "!a:localhost" };
    expect(compareDmRoomScore(busy, quiet)).toBeLessThan(0);
  });

  it("uses the same room id when both rooms are empty (duplicate create)", () => {
    const roomA = { messageCount: 0, bothJoined: false, membershipRank: 2, roomId: "!aaa:localhost" };
    const roomB = { messageCount: 0, bothJoined: false, membershipRank: 1, roomId: "!bbb:localhost" };
    expect(compareDmRoomScore(roomA, roomB)).toBeLessThan(0);
    expect(compareDmRoomScore(roomB, roomA)).toBeGreaterThan(0);
  });

  it("prefers a room where both users joined when message counts tie", () => {
    const shared = { messageCount: 2, bothJoined: true, membershipRank: 2, roomId: "!z:localhost" };
    const partial = { messageCount: 2, bothJoined: false, membershipRank: 2, roomId: "!a:localhost" };
    expect(compareDmRoomScore(shared, partial)).toBeLessThan(0);
  });
});

describe("sendMatrixTyping", () => {
  it("skips typing when the user is not joined to the room", async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const client = {
      getRoom: () => ({ getMyMembership: () => "leave" }),
      sendTyping,
    } as unknown as import("matrix-js-sdk").MatrixClient;

    expect(canSendMatrixTyping(client, "!room:localhost")).toBe(false);
    await sendMatrixTyping(client, "!room:localhost", true);
    expect(sendTyping).not.toHaveBeenCalled();
  });

  it("swallows M_FORBIDDEN from Synapse", async () => {
    const sendTyping = vi.fn().mockRejectedValue({ errcode: "M_FORBIDDEN" });
    const client = {
      getRoom: () => ({ getMyMembership: () => "join" }),
      sendTyping,
    } as unknown as import("matrix-js-sdk").MatrixClient;

    await expect(sendMatrixTyping(client, "!room:localhost", true)).resolves.toBeUndefined();
  });
});