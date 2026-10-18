import { describe, expect, it } from "vitest";
import { chatRoutes } from "./chat-routes";

const ws = { orgSlug: "acme", wsSlug: "hq" };

describe("chatRoutes", () => {
  it("builds the chat screens' paths under the workspace", () => {
    expect(chatRoutes.room(ws, "r1")).toBe("/acme/hq/room/r1");
    expect(chatRoutes.room(ws, "r1", "m 1")).toBe("/acme/hq/room/r1?message=m%201");
    expect(chatRoutes.thread(ws, "r1", "root")).toBe("/acme/hq/room/r1/thread/root");
    expect(chatRoutes.info(ws, "r1")).toBe("/acme/hq/room/r1/info");
    expect(chatRoutes.newChat(ws)).toBe("/acme/hq/new-chat");
    expect(chatRoutes.channels({ orgSlug: "a b", wsSlug: "c" })).toBe("/a%20b/c/channels");
  });
});
