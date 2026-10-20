import { beforeAll, describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";
import { initI18n } from "@uniwork/core/i18n";
import { hasSummarySource, summarySourceFacts, summarySourceList } from "./summary-sources";

beforeAll(() => {
  initI18n();
});

const none = { transcript: [], notes: [], chat: [], votes: [] };

describe("summarySourceFacts", () => {
  const at = "2026-09-22T02:20:00Z";

  it("judges the sources by what existed when the summary was made", () => {
    expect(
      summarySourceFacts(at, { ...none, transcript: ["2026-09-22T02:10:00Z"], notes: ["2026-09-22T02:15:00Z"] }),
    ).toEqual({ sources: ["transcript", "notes"], stale: false });
    expect(summarySourceFacts(at, { ...none, chat: ["2026-09-22T02:05:00Z"] })).toEqual({ sources: ["chat"], stale: false });
    expect(summarySourceFacts(at, { ...none, votes: ["2026-09-22T02:19:00Z"] })).toEqual({ sources: ["votes"], stale: false });
  });

  it("marks the summary stale when any source, chat and votes included, came later", () => {
    expect(summarySourceFacts(at, { ...none, transcript: ["2026-09-22T02:30:00Z"] })).toEqual({ sources: [], stale: true });
    expect(summarySourceFacts(at, { ...none, chat: ["2026-09-22T02:30:00Z"] }).stale).toBe(true);
    expect(summarySourceFacts(at, { ...none, votes: ["2026-09-22T02:30:00Z"] }).stale).toBe(true);
  });

  it("claims nothing without a generation time or a usable timestamp", () => {
    expect(summarySourceFacts(undefined, { ...none, transcript: ["2026-09-22T02:10:00Z"] })).toEqual({
      sources: [],
      stale: false,
    });
    expect(summarySourceFacts(at, { ...none, notes: [null] })).toEqual({ sources: [], stale: false });
  });
});

describe("summarySourceList", () => {
  it("names the sources as one localized list", () => {
    const t = getI18n().t;
    expect(summarySourceList(["transcript", "notes", "votes"], t, "vi-VN")).toBe(
      "bản ghi lời thoại, ghi chú và kết quả biểu quyết",
    );
    expect(summarySourceList([], t, "vi-VN")).toBeNull();
  });
});

describe("hasSummarySource", () => {
  it("is the server's test: any of transcript, notes, chat or a closed vote", () => {
    expect(hasSummarySource({ transcript: 0, notes: 0, chat: 0, votes: 0 })).toBe(false);
    expect(hasSummarySource({ transcript: 0, notes: 0, chat: 0, votes: 1 })).toBe(true);
    expect(hasSummarySource({ transcript: 0, notes: 0, chat: 2, votes: 0 })).toBe(true);
  });
});
