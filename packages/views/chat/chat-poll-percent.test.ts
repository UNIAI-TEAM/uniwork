import { describe, expect, it } from "vitest";
import { pollOptionPercents } from "./chat-poll-percent";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("pollOptionPercents", () => {
  it("is 0% for every option when nobody voted", () => {
    expect(pollOptionPercents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(pollOptionPercents([])).toEqual([]);
  });

  it("adds up to 100, the leftover point going to the largest remainder", () => {
    // 45.45 / 36.36 / 18.18 / 0 → the .45 takes the missing point.
    expect(pollOptionPercents([5, 4, 2, 0])).toEqual([46, 36, 18, 0]);
    expect(pollOptionPercents([2, 1])).toEqual([67, 33]);
    expect(sum(pollOptionPercents([7, 4, 1]))).toBe(100);
  });

  it("breaks a tie toward the earlier option and never lifts a 0-vote option", () => {
    expect(pollOptionPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(pollOptionPercents([1, 0, 1, 1])).toEqual([34, 0, 33, 33]);
  });

  it("keeps exact shares as they are", () => {
    expect(pollOptionPercents([1, 1])).toEqual([50, 50]);
    expect(pollOptionPercents([3, 0])).toEqual([100, 0]);
  });
});
