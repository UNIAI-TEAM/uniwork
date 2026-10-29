import { describe, expect, it } from "vitest";
import { accountRoutes, chatRoutes } from "./chat-routes";

const ws = { orgSlug: "acme", wsSlug: "hq" };

describe("chatRoutes", () => {
  it("builds the chat screens' paths under the workspace", () => {
    expect(chatRoutes.room(ws, "r1")).toBe("/acme/hq/room/r1");
    expect(chatRoutes.room(ws, "r1", "m 1")).toBe("/acme/hq/room/r1?message=m%201");
    expect(chatRoutes.thread(ws, "r1", "root")).toBe("/acme/hq/room/r1/thread/root");
    expect(chatRoutes.info(ws, "r1")).toBe("/acme/hq/room/r1/info");
    expect(chatRoutes.members(ws, "r 1")).toBe("/acme/hq/room/r%201/members");
    expect(chatRoutes.newChat(ws)).toBe("/acme/hq/new-chat");
    expect(chatRoutes.channels({ orgSlug: "a b", wsSlug: "c" })).toBe("/a%20b/c/channels");
    expect(chatRoutes.newGroup(ws)).toBe("/acme/hq/new-group");
    expect(chatRoutes.newGroup(ws, "g/1")).toBe("/acme/hq/new-group?room=g%2F1");
  });

  // Reachable with no workspace at all (select-workspace › Settings): account deletion and the
  // legal pages may never sit behind a workspace (Apple 5.1.1(v), Play's account deletion policy).
  it("keeps the account's screens outside every workspace", () => {
    expect(accountRoutes).toEqual({ settings: "/account", licenses: "/licenses", password: "/password" });
  });
});
