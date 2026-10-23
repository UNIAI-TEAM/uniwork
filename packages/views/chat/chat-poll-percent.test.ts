import { describe, expect, it } from "vitest";
import { pollOptionPercents } from "./chat-poll-percent";

describe("pollOptionPercents", () => {
  it("is 0% for every option when nobody voted", () => {
    expect(pollOptionPercents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(pollOptionPercents([])).toEqual([]);
  });

  it("rounds each option's share on its own, as the canvas reads them", () => {
    expect(pollOptionPercents([5, 4, 2, 0])).toEqual([45, 36, 18, 0]);
    expect(pollOptionPercents([7, 4, 1])).toEqual([58, 33, 8]);
    expect(pollOptionPercents([4, 2, 1])).toEqual([57, 29, 14]);
    expect(pollOptionPercents([2, 1])).toEqual([67, 33]);
  });

  it("keeps exact shares as they are", () => {
    expect(pollOptionPercents([1, 1])).toEqual([50, 50]);
    expect(pollOptionPercents([3, 0])).toEqual([100, 0]);
  });
});
