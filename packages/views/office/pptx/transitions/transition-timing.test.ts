import { describe, expect, it } from "vitest";
import { advanceMsToSecondsText, advanceSecondsIsValid, parseAdvanceSeconds } from "./transition-timing";

describe("advanceMsToSecondsText", () => {
  it("renders whole seconds without trailing zeros", () => {
    expect(advanceMsToSecondsText(5000)).toBe("5");
    expect(advanceMsToSecondsText(2000)).toBe("2");
    expect(advanceMsToSecondsText(0)).toBe("0");
  });

  it("keeps up to three decimals for sub-second timers", () => {
    expect(advanceMsToSecondsText(1500)).toBe("1.5");
    expect(advanceMsToSecondsText(250)).toBe("0.25");
    expect(advanceMsToSecondsText(1)).toBe("0.001");
  });

  it("shows an empty field when no timer is set", () => {
    expect(advanceMsToSecondsText(null)).toBe("");
    expect(advanceMsToSecondsText(undefined)).toBe("");
    expect(advanceMsToSecondsText(Number.NaN)).toBe("");
    expect(advanceMsToSecondsText(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("clamps a negative value to zero rather than rendering a negative field", () => {
    expect(advanceMsToSecondsText(-1000)).toBe("0");
  });
});

describe("parseAdvanceSeconds", () => {
  it("clears the timer on an empty or blank field", () => {
    expect(parseAdvanceSeconds("")).toEqual({ kind: "clear" });
    expect(parseAdvanceSeconds("   ")).toEqual({ kind: "clear" });
  });

  it("converts seconds to whole milliseconds", () => {
    expect(parseAdvanceSeconds("5")).toEqual({ kind: "ms", ms: 5000 });
    expect(parseAdvanceSeconds("1.5")).toEqual({ kind: "ms", ms: 1500 });
    expect(parseAdvanceSeconds("0")).toEqual({ kind: "ms", ms: 0 });
    expect(parseAdvanceSeconds(" 2 ")).toEqual({ kind: "ms", ms: 2000 });
  });

  it("rounds a fractional millisecond to a whole one (the engine rounds too)", () => {
    expect(parseAdvanceSeconds("0.0005")).toEqual({ kind: "ms", ms: 1 });
  });

  it("refuses negative, non-numeric and non-finite input", () => {
    expect(parseAdvanceSeconds("-1")).toEqual({ kind: "invalid" });
    expect(parseAdvanceSeconds("abc")).toEqual({ kind: "invalid" });
    expect(parseAdvanceSeconds("Infinity")).toEqual({ kind: "invalid" });
    expect(parseAdvanceSeconds("1e999")).toEqual({ kind: "invalid" });
    expect(parseAdvanceSeconds(".")).toEqual({ kind: "invalid" });
    expect(parseAdvanceSeconds("-")).toEqual({ kind: "invalid" });
  });
});

describe("advanceSecondsIsValid", () => {
  it("is true for a value or a clear, false only for invalid input", () => {
    expect(advanceSecondsIsValid("")).toBe(true);
    expect(advanceSecondsIsValid("2")).toBe(true);
    expect(advanceSecondsIsValid("0")).toBe(true);
    expect(advanceSecondsIsValid("-2")).toBe(false);
    expect(advanceSecondsIsValid("nope")).toBe(false);
  });
});
