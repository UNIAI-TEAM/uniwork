import { describe, expect, it } from "vitest";
import { pptxTextCounts } from "./status-counts";

describe("pptxTextCounts", () => {
  it("counts words by whitespace and characters by length across runs", () => {
    expect(pptxTextCounts([{ text: "Xin chào  các bạn" }, { text: " " }, { text: "" }, { text: "ok" }])).toEqual({
      words: 5,
      characters: 20,
    });
  });

  it("is zero for an empty deck, a known value rather than a placeholder", () => {
    expect(pptxTextCounts([])).toEqual({ words: 0, characters: 0 });
  });
});
