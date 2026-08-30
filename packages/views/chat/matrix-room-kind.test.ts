import { describe, expect, it } from "vitest";
import { isAdHocGroupRoom, isPrivateDmRoom } from "./matrix-room-kind";

function mockRoom(options: {
  roomId: string;
  myMembership: string;
  members: string[];
  isDirect?: boolean;
}): Parameters<typeof isAdHocGroupRoom>[0] {
  return {
    roomId: options.roomId,
    getMyMembership: () => options.myMembership,
    getJoinedMembers: () =>
      options.members.map((userId) => ({ userId, name: userId })),
    getMembersWithMembership: () => [],
    currentState: {
      getStateEvents: (type: string) =>
        type === "m.room.create"
          ? { getContent: () => ({ is_direct: options.isDirect }) }
          : undefined,
    },
    getLiveTimeline: () => ({ getEvents: () => [] }),
    name: "Team",
  } as never;
}

describe("isPrivateDmRoom", () => {
  const me = "@me:localhost";

  it("accepts a direct two-person room", () => {
    const room = mockRoom({
      roomId: "!dm:localhost",
      myMembership: "join",
      members: [me, "@a:localhost"],
      isDirect: true,
    });
    expect(isPrivateDmRoom(room, me, "@a:localhost")).toBe(true);
  });

  it("rejects an explicit non-direct two-person room", () => {
    const room = mockRoom({
      roomId: "!pair:localhost",
      myMembership: "join",
      members: [me, "@a:localhost"],
      isDirect: false,
    });
    expect(isPrivateDmRoom(room, me, "@a:localhost")).toBe(false);
  });

  it("rejects a three-person room even when is_direct is missing", () => {
    const room = mockRoom({
      roomId: "!group:localhost",
      myMembership: "join",
      members: [me, "@a:localhost", "@b:localhost"],
    });
    expect(isPrivateDmRoom(room, me)).toBe(false);
  });
});

describe("isAdHocGroupRoom", () => {
  const me = "@me:localhost";

  it("accepts a private room with two other members", () => {
    const room = mockRoom({
      roomId: "!group:localhost",
      myMembership: "join",
      members: [me, "@a:localhost", "@b:localhost"],
      isDirect: false,
    });
    expect(isAdHocGroupRoom(room, me, "!ws:localhost")).toBe(true);
  });

  it("rejects workspace and direct rooms", () => {
    const wsRoom = mockRoom({
      roomId: "!ws:localhost",
      myMembership: "join",
      members: [me, "@a:localhost", "@b:localhost"],
    });
    expect(isAdHocGroupRoom(wsRoom, me, "!ws:localhost")).toBe(false);

    const dmRoom = mockRoom({
      roomId: "!dm:localhost",
      myMembership: "join",
      members: [me, "@a:localhost"],
      isDirect: true,
    });
    expect(isAdHocGroupRoom(dmRoom, me, null)).toBe(false);
  });
});
