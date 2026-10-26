// Parity: the linkify and bold cases of packages/views/chat/chat-message-body.test.tsx,
// read as segments instead of DOM, plus what the phone adds on top (the
// distinct links a screen reader can open, a link named without its scheme).
import { describe, expect, it } from "vitest";
import { messageBodySegments, messageLinks, spokenLink } from "./message-format";

const text = (value: string, bold = false) => ({ kind: "text", text: value, bold });
const link = (url: string, bold = false) => ({ kind: "link", text: url, url, bold });

describe("messageBodySegments", () => {
  it("sets **bold** in bold without showing the stars", () => {
    expect(messageBodySegments("Chốt lịch: **thứ Năm 24/10, 9:00**. Còn **")).toEqual([text("Chốt lịch: "), text("thứ Năm 24/10, 9:00", true), text(". Còn **")]);
  });

  it("makes a web address a link, leaving the sentence's full stop outside it", () => {
    expect(messageBodySegments("Xem https://docs.example.com/a?b=1. rồi báo nhé")).toEqual([text("Xem "), link("https://docs.example.com/a?b=1"), text(". rồi báo nhé")]);
  });

  it("links an address after a mention, and keeps the mention apart", () => {
    expect(messageBodySegments("[@Binh](mention://member/u2) xem https://a.example/x nhé")).toEqual([
      { kind: "mention", text: "@Binh", mention: "member", userId: "u2" },
      text(" xem "),
      link("https://a.example/x"),
      text(" nhé"),
    ]);
  });

  it("links an address inside bold, in bold", () => {
    expect(messageBodySegments("**https://a.example/b** ok")).toEqual([link("https://a.example/b", true), text(" ok")]);
  });

  it("leaves closing brackets, quotes and punctuation out of a link", () => {
    expect(messageBodySegments("(https://a.example/x), [http://b.example/y]!")).toEqual([
      text("("),
      link("https://a.example/x"),
      text("), ["),
      link("http://b.example/y"),
      text("]!"),
    ]);
  });

  it("is one plain run without links, bold or mentions, and nothing for an empty body", () => {
    expect(messageBodySegments("chào cả nhà")).toEqual([text("chào cả nhà")]);
    expect(messageBodySegments("[@all](mention://all/all)")).toEqual([{ kind: "mention", text: "@all", mention: "all", userId: undefined }]);
    expect(messageBodySegments("")).toEqual([]);
  });
});

describe("messageLinks", () => {
  it("lists each address once, in reading order", () => {
    expect(messageLinks("https://b.example then https://a.example and **https://b.example**")).toEqual(["https://b.example", "https://a.example"]);
    expect(messageLinks("no link")).toEqual([]);
  });
});

describe("spokenLink", () => {
  it("names a link without its scheme or trailing slash", () => {
    expect(spokenLink("https://docs.example.com/")).toBe("docs.example.com");
    expect(spokenLink("http://a.example/x?y=1")).toBe("a.example/x?y=1");
  });
});
