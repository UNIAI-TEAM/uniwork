import { describe, expect, it } from "vitest";
import { paths } from "./paths";

describe("paths.workspace().documentsFolder", () => {
  const ws = paths.workspace("acme", "team");

  it("opens a folder through the documents route's query string", () => {
    expect(ws.documentsFolder("f1")).toBe("/acme/team/documents?folder=f1");
  });

  it("encodes the folder id", () => {
    expect(ws.documentsFolder("a/b?c&d")).toBe("/acme/team/documents?folder=a%2Fb%3Fc%26d");
  });

  // Not a page: the path part is the existing documents route, so the
  // builder ↔ page walk in consistency.test.ts has nothing new to match and
  // deliberately does not list it (no apps/web page backs `?folder=`).
  it("adds no route of its own", () => {
    const url = new URL(ws.documentsFolder("f1"), "http://x.test");
    expect(url.pathname).toBe(ws.documents());
    expect(url.searchParams.get("folder")).toBe("f1");
  });
});

describe("paths.workspace().chat", () => {
  const ws = paths.workspace("acme", "team");

  it("is the plain module path with no target, as every existing caller uses it", () => {
    expect(ws.chat()).toBe("/acme/team/chat");
    expect(ws.chat({})).toBe("/acme/team/chat");
  });

  it("opens a room, and a message in it", () => {
    expect(ws.chat({ room: "r1" })).toBe("/acme/team/chat?room=r1");
    expect(ws.chat({ room: "r1", message: "m1" })).toBe("/acme/team/chat?room=r1&message=m1");
  });

  it("names a message only together with its room", () => {
    expect(ws.chat({ message: "m1" })).toBe("/acme/team/chat");
  });

  it("encodes both ids", () => {
    expect(ws.chat({ room: "a/b?c", message: "x&y" })).toBe("/acme/team/chat?room=a%2Fb%3Fc&message=x%26y");
  });

  // Not a page: the query rides on the existing chat route (use-chat-room-url).
  it("adds no route of its own", () => {
    const url = new URL(ws.chat({ room: "r1", message: "m1" }), "http://x.test");
    expect(url.pathname).toBe(ws.chat());
  });
});
