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

  it("encodes both ids and rides on the chat route", () => {
    const href = ws.chatConversation("a/b?c", "x&y");
    expect(href).toBe("/acme/team/chat?room=a%2Fb%3Fc&message=x%26y");
    const url = new URL(href, "http://x.test");
    expect(url.pathname).toBe(ws.chat());
  });
});

describe("paths.workspace() chat scopes", () => {
  const ws = paths.workspace("acme", "team");

  it("names the organization's messages and the workspace's channels", () => {
    expect(ws.chatMessages()).toBe("/acme/team/chat?view=messages");
    expect(ws.chatChannels()).toBe("/acme/team/chat?view=channels");
  });
});
