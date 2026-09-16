import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { TaskComment } from "@uniwork/core/types";
import {
  buildThreadNavThreads,
  commentThreadPreview,
  formatStamp,
  highlightMatches,
  matchesFilter,
  mentionsUser,
  scrollCommentIntoContainer,
  threadDayGroup,
  type ThreadNavThread,
} from "./thread-nav-helpers";

function comment(partial: Partial<TaskComment> & Pick<TaskComment, "id" | "body">): TaskComment {
  return {
    task_id: "t1",
    author_id: "user-1",
    author_kind: "human",
    created_at: new Date().toISOString(),
    reactions: [],
    type: "comment",
    revision: 0,
    ...partial,
  };
}

function thread(
  id: string,
  body: string,
  overrides: Partial<ThreadNavThread> = {},
): ThreadNavThread {
  return {
    id,
    entry: comment({ id, body }),
    resolved: false,
    replyCount: 0,
    involvesMe: false,
    ...overrides,
  };
}

describe("threadDayGroup", () => {
  const now = new Date("2026-08-05T12:00:00").getTime();

  it("buckets by local calendar day", () => {
    expect(threadDayGroup(new Date("2026-08-05T00:30:00").toISOString(), now)).toBe("today");
    expect(threadDayGroup(new Date("2026-08-04T23:30:00").toISOString(), now)).toBe("yesterday");
    expect(threadDayGroup(new Date("2026-08-03T23:30:00").toISOString(), now)).toBe("earlier");
  });

  it("treats an unparseable timestamp as earlier rather than throwing", () => {
    expect(threadDayGroup("not-a-date", now)).toBe("earlier");
    expect(threadDayGroup(undefined, now)).toBe("earlier");
  });
});

describe("formatStamp", () => {
  const at = (iso: string) => new Date(iso).toISOString();

  it("shows a clock time under today and yesterday", () => {
    expect(formatStamp(at("2026-08-05T14:20:00"), "today")).toMatch(/\d/);
    expect(formatStamp(at("2026-08-05T14:20:00"), "today")).not.toMatch(/[A-Za-z]{3}/);
    expect(formatStamp(at("2026-08-04T14:20:00"), "yesterday")).not.toMatch(/[A-Za-z]{3}/);
  });

  it("always shows a date under earlier", () => {
    expect(formatStamp(at("2026-08-03T23:41:00"), "earlier")).toMatch(/[A-Za-z]{3}|\d+\/\d+|月/);
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatStamp("not-a-date", "today")).toBe("");
  });
});

describe("matchesFilter", () => {
  it("splits on resolution and participation", () => {
    const open = thread("a", "x");
    const done = thread("b", "x", { resolved: true });
    const mine = thread("c", "x", { involvesMe: true });

    expect(matchesFilter(open, "all")).toBe(true);
    expect(matchesFilter(open, "unresolved")).toBe(true);
    expect(matchesFilter(done, "unresolved")).toBe(false);
    expect(matchesFilter(done, "resolved")).toBe(true);
    expect(matchesFilter(mine, "mine")).toBe(true);
    expect(matchesFilter(open, "mine")).toBe(false);
  });

  it("keeps every thread for an unknown filter instead of emptying the list", () => {
    expect(matchesFilter(thread("a", "x"), "sideways" as never)).toBe(true);
  });
});

describe("highlightMatches", () => {
  it("returns the text untouched when there is no query", () => {
    expect(highlightMatches("Invite links", "")).toBe("Invite links");
    expect(highlightMatches("Invite links", "   ")).toBe("Invite links");
  });

  it("splits on every occurrence, case-insensitively", () => {
    const parts = highlightMatches("Workspace and workspace_id", "workspace");
    expect(Array.isArray(parts)).toBe(true);
    const marks = (parts as ReactNode[]).filter(
      (p): p is ReactElement<{ children: string }> =>
        typeof p === "object" && p !== null && "type" in p && p.type === "mark",
    );
    expect(marks).toHaveLength(2);
    expect(marks[0]!.props.children).toBe("Workspace");
    expect(marks[1]!.props.children).toBe("workspace");
  });

  it("does not drop text before, between, or after matches", () => {
    const parts = highlightMatches("ab X cd X ef", "X") as ReactNode[];
    const text = parts
      .map((p) =>
        typeof p === "string"
          ? p
          : (p as ReactElement<{ children: string }>).props.children,
      )
      .join("");
    expect(text).toBe("ab X cd X ef");
  });
});

describe("mentionsUser", () => {
  it("matches the markdown mention link form", () => {
    expect(mentionsUser("hey [@Jiayuan](mention://member/user-1) look", "user-1")).toBe(true);
  });

  it("matches the legacy shortcode form still sitting in the database", () => {
    expect(mentionsUser('hey [@ id="user-1" label="Jiayuan"] look', "user-1")).toBe(true);
    expect(mentionsUser('[@ id="user-2" label="Wei"]', "user-1")).toBe(false);
  });

  it("does not match another member or an agent mention", () => {
    expect(mentionsUser("[@Wei](mention://member/user-2)", "user-1")).toBe(false);
    expect(mentionsUser("[@Lambda](mention://agent/user-1)", "user-1")).toBe(false);
  });

  it("is false for empty content or a missing user id", () => {
    expect(mentionsUser(undefined, "user-1")).toBe(false);
    expect(mentionsUser("[@x](mention://member/)", "")).toBe(false);
  });
});

describe("commentThreadPreview", () => {
  it("takes the first non-empty line as title and the rest as body", () => {
    expect(commentThreadPreview("# Hello\n\nMore detail here")).toEqual({
      title: "Hello",
      body: "More detail here",
    });
  });

  it("strips fenced code and link syntax", () => {
    expect(commentThreadPreview("See [docs](https://x.test)\n```\ncode\n```\nTail")).toEqual({
      title: "See docs",
      body: "Tail",
    });
  });
});

describe("buildThreadNavThreads", () => {
  it("counts reply depth and flags involvement by authorship or mention", () => {
    const rows = buildThreadNavThreads(
      [
        comment({ id: "r1", body: "root", author_id: "other" }),
        comment({
          id: "c2",
          body: "[@Me](mention://member/me)",
          author_id: "other",
          parent_id: "r1",
        }),
        comment({ id: "r2", body: "mine", author_id: "me" }),
      ],
      "me",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "r1", replyCount: 1, involvesMe: true });
    expect(rows[1]).toMatchObject({ id: "r2", replyCount: 0, involvesMe: true });
  });

  it("marks resolved when a reply carries the resolution", () => {
    const rows = buildThreadNavThreads(
      [
        comment({ id: "r1", body: "open" }),
        comment({
          id: "c2",
          body: "done",
          parent_id: "r1",
          resolved_at: "2026-08-05T12:00:00Z",
        }),
      ],
      undefined,
    );
    expect(rows[0]?.resolved).toBe(true);
  });
});

describe("scrollCommentIntoContainer", () => {
  it("adjusts container scrollTop so the target top sits below the gap", () => {
    const container = document.createElement("div");
    const el = document.createElement("div");
    Object.defineProperty(container, "scrollTop", { value: 100, writable: true });
    viRect(container, { top: 50, bottom: 450 });
    viRect(el, { top: 200, bottom: 260 });
    scrollCommentIntoContainer(el, container, 16);
    expect(container.scrollTop).toBe(100 + (200 - 50) - 16);
  });
});

function viRect(el: HTMLElement, box: { top: number; bottom: number }) {
  el.getBoundingClientRect = () =>
    ({
      top: box.top,
      bottom: box.bottom,
      left: 0,
      right: 100,
      width: 100,
      height: box.bottom - box.top,
      x: 0,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;
}
