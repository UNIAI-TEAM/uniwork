import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { serializeQuestion } from "./ask-uni-question";

const text = (value: string): JSONContent => ({ type: "text", text: value });
const card = (kind: string, id: string, label: string): JSONContent => ({ type: "askUniMention", attrs: { kind, id, label } });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content }] });

describe("serializeQuestion", () => {
  it("puts a card's label where it sits in the sentence and lists the card", () => {
    expect(serializeQuestion(doc(text("Tóm tắt "), card("task", "T", "Đăng nhập"), text(" giúp")))).toEqual({
      text: "Tóm tắt Đăng nhập giúp",
      mentions: [{ kind: "task", id: "T", label: "Đăng nhập" }],
    });
  });

  it("keeps one entry for a card named twice, but not for another kind with the same id", () => {
    const out = serializeQuestion(doc(card("task", "T", "A"), text(" và "), card("task", "T", "A"), text(" "), card("member", "T", "Lan")));
    expect(out.text).toBe("A và A Lan");
    expect(out.mentions).toEqual([
      { kind: "task", id: "T", label: "A" },
      { kind: "member", id: "T", label: "Lan" },
    ]);
  });

  it("reads the pick's own space and the one typed after it as one space", () => {
    expect(serializeQuestion(doc(text("So sánh task này với "), card("document", "D", "Nội dung giới thiệu"), text(" "), text(" về mức\t\t độ")))).toEqual({
      text: "So sánh task này với Nội dung giới thiệu về mức độ",
      mentions: [{ kind: "document", id: "D", label: "Nội dung giới thiệu" }],
    });
  });

  it("turns a line break into a newline and trims the ends", () => {
    expect(serializeQuestion(doc(text("  Một"), { type: "hardBreak" }, text("Hai "), { type: "hardBreak" }))).toEqual({ text: "Một\nHai", mentions: [] });
  });

  it("joins paragraphs with a newline and reads an empty document as empty", () => {
    expect(serializeQuestion({ type: "doc", content: [{ type: "paragraph", content: [text("A")] }, { type: "paragraph", content: [text("B")] }] }).text).toBe("A\nB");
    expect(serializeQuestion({ type: "doc", content: [{ type: "paragraph" }] })).toEqual({ text: "", mentions: [] });
  });
});
