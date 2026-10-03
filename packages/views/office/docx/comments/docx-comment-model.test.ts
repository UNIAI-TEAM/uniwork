import { describe, expect, it } from "vitest";
import type { DocxCommentInfo } from "@uniwork/office-engine/docx";
import {
  applyThreadResolved,
  commentInitials,
  commentTimestamp,
  formatCommentDate,
  groupCommentThreads,
  nextCommentId,
  removeThread,
  threadIds,
} from "./docx-comment-model";

const MAIN: DocxCommentInfo = { id: "1", author: "Alice", text: "first", date: "2026-07-01T10:00:00Z" };
const REPLY: DocxCommentInfo = { id: "2", author: "Bob", text: "reply", parentId: "1" };
const SECOND: DocxCommentInfo = { id: "3", author: "A", text: "second", done: true };

describe("docx comment model", () => {
  it("allocates the smallest unused numeric id", () => {
    expect(nextCommentId([])).toBe("1");
    expect(nextCommentId([MAIN])).toBe("2");
    expect(nextCommentId([MAIN, REPLY])).toBe("3");
    expect(nextCommentId([{ id: "x", author: "A", text: "t" }])).toBe("1");
    expect(nextCommentId([{ id: "7", author: "A", text: "t" }])).toBe("8");
  });

  it("treats a comment and its replies as one thread", () => {
    const list = [MAIN, REPLY, SECOND];
    expect(threadIds(list, "1")).toEqual(["1", "2"]);
    expect(threadIds(list, "3")).toEqual(["3"]);
    expect(applyThreadResolved(list, "1", true).map((c) => c.done)).toEqual([true, true, true]);
    expect(removeThread(list, "1").map((c) => c.id)).toEqual(["3"]);
  });

  it("splits open and resolved threads, keeping orphans visible", () => {
    const orphan: DocxCommentInfo = { id: "9", author: "X", text: "orphan", parentId: "404" };
    const { open, resolved } = groupCommentThreads([MAIN, REPLY, SECOND, orphan]);
    expect(open.map((thread) => thread.id)).toEqual(["1", "9"]);
    expect(open[0]?.replies.map((reply) => reply.id)).toEqual(["2"]);
    expect(resolved.map((thread) => thread.id)).toEqual(["3"]);
  });

  it("stamps and formats dates without inventing values", () => {
    expect(commentTimestamp(new Date("2026-07-01T10:00:00.123Z"))).toBe("2026-07-01T10:00:00Z");
    expect(formatCommentDate(undefined, "en")).toBe("");
    expect(formatCommentDate("not a date", "en")).toBe("");
    expect(formatCommentDate("2026-07-01T10:00:00Z", "en")).not.toBe("");
  });

  it("derives avatar text from initials or author words", () => {
    expect(commentInitials({ author: "Alice" })).toBe("AL");
    expect(commentInitials({ author: "Alice Nguyen" })).toBe("AN");
    expect(commentInitials({ author: "Alice", initials: "AN" })).toBe("AN");
    expect(commentInitials({ author: "" })).toBe("?");
  });
});
