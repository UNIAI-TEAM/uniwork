import { describe, expect, it } from "vitest";
import { DRAFT_TTL_MS, draftKey, isEmptyDraft, readDrafts, roomDraftLines } from "./drafts";

const NOW = Date.UTC(2026, 9, 22);

describe("draftKey", () => {
  it("is per person, workspace, room and thread", () => {
    expect(draftKey("u1", "w1", "r1")).toBe("u1/w1/r1/");
    expect(draftKey("u1", "w1", "r1", "t1")).toBe("u1/w1/r1/t1");
  });
});

describe("isEmptyDraft", () => {
  it("keeps text or a quoted message, and nothing else", () => {
    expect(isEmptyDraft({ text: "  \n" })).toBe(true);
    expect(isEmptyDraft({ text: "chào" })).toBe(false);
    expect(isEmptyDraft({ text: "", reply: { id: "m1", sender: "Bình", text: "ok" } })).toBe(false);
  });
});

describe("readDrafts", () => {
  it("keeps each whole, recent, non-empty draft and drops the rest alone", () => {
    const value = {
      "u1/w1/r1/": { text: "đang viết", updatedAt: NOW - 1000 },
      "u1/w1/r2/": { text: "", reply: { id: "m1", sender: "Bình", text: "ok" }, updatedAt: NOW },
      "u1/w1/r3/": { text: "cũ", updatedAt: NOW - DRAFT_TTL_MS },
      "u1/w1/r4/": { text: 42, updatedAt: NOW },
      "u1/w1/r5/": { text: " ", updatedAt: NOW },
      "u1/w1/r6/": { text: "x", reply: { id: "", sender: "", text: "" }, updatedAt: NOW },
    };
    expect(Object.keys(readDrafts(value, NOW))).toEqual(["u1/w1/r1/", "u1/w1/r2/"]);
  });

  it("reads anything that is not a record as no drafts", () => {
    expect(readDrafts(null, NOW)).toEqual({});
    expect(readDrafts([], NOW)).toEqual({});
    expect(readDrafts("x", NOW)).toEqual({});
  });
});

describe("roomDraftLines", () => {
  it("gives each room of this person's workspace its draft as one line, not a thread's or another's", () => {
    const drafts = {
      "u1/w1/r1/": { text: "  Mai\n\nhọp  nhé ", updatedAt: NOW },
      "u1/w1/r1/t1": { text: "trong chủ đề", updatedAt: NOW },
      "u1/w1/r2/": { text: "", reply: { id: "m1", sender: "Bình", text: "ok" }, updatedAt: NOW },
      "u1/w2/r3/": { text: "workspace khác", updatedAt: NOW },
      "u2/w1/r4/": { text: "người khác", updatedAt: NOW },
    };
    expect(roomDraftLines(drafts, "u1", "w1")).toEqual({ r1: "Mai họp nhé" });
  });
});
