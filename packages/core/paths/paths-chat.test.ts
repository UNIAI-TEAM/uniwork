import { describe, expect, it } from "vitest";
import { paths } from "./paths";

describe("paths.workspace().chatConversation", () => {
  const ws = paths.workspace("acme", "team");

  it("opens a room on the chat page", () => {
    expect(ws.chatConversation("room1")).toBe("/acme/team/chat?room=room1");
  });

  it("scrolls to a message when given", () => {
    expect(ws.chatConversation("room1", "msg1")).toBe("/acme/team/chat?room=room1&message=msg1");
  });
});
