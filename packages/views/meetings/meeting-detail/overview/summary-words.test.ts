import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { sourceCounts, sourceWords } from "./summary-words";

let i18n: ReturnType<typeof initI18n>;
beforeAll(() => {
  i18n = initI18n();
});

const times = {
  transcript: ["2026-10-22T02:01:00Z", "2026-10-22T02:20:00Z", "2026-10-22T02:40:00Z"],
  notes: ["2026-10-22T02:18:00Z", null],
  chat: [],
  votes: [],
};

describe("summary source words", () => {
  it("counts what existed when the summary was made, or everything without a cutoff", () => {
    expect(sourceCounts(times, "2026-10-22T02:31:00Z")).toEqual({ transcript: 2, notes: 1, chat: 0, votes: 0 });
    expect(sourceCounts(times)).toEqual({ transcript: 3, notes: 2, chat: 0, votes: 0 });
  });

  it("names the non-empty sources as one list", () => {
    const t = i18n.t.bind(i18n);
    expect(sourceWords({ transcript: 119, notes: 2, chat: 0, votes: 0 }, t, "vi-VN")).toBe("119 câu thoại và 2 ghi chú");
    expect(sourceWords({ transcript: 119, notes: 2, chat: 0, votes: 0 }, t, "vi-VN", { lead: true })).toBe("Lời thoại 119 câu và 2 ghi chú");
    expect(sourceWords({ transcript: 0, notes: 0, chat: 0, votes: 0 }, t, "vi-VN")).toBe("");
  });
});
