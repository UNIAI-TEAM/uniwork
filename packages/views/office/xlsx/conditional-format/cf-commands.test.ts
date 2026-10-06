import { describe, expect, it } from "vitest";
import { addRuleParams, buildCfInnerRule, cfStyleOf, clearRangeParams, clearSheetParams } from "./cf-commands";

const input = (first: string, second = "") => ({ first, second });

describe("buildCfInnerRule", () => {
  it("builds greater/less than number rules", () => {
    expect(buildCfInnerRule("greaterThan", input(" 5.5 "), "lightRedDarkRed")).toEqual({
      ok: true,
      inner: {
        type: "highlightCell",
        subType: "number",
        operator: "greaterThan",
        value: 5.5,
        style: { bg: { rgb: "#FFC7CE" }, cl: { rgb: "#9C0006" } },
      },
    });
    expect(buildCfInnerRule("lessThan", input("-2"), "redText")).toEqual({
      ok: true,
      inner: { type: "highlightCell", subType: "number", operator: "lessThan", value: -2, style: { cl: { rgb: "#9C0006" } } },
    });
  });

  it("rejects empty and non-finite numbers", () => {
    for (const raw of ["", "  ", "abc", "Infinity", "NaN"]) {
      expect(buildCfInnerRule("greaterThan", input(raw), "redText")).toEqual({ ok: false, error: "invalidNumber" });
    }
  });

  it("builds between with min <= max and rejects the reverse", () => {
    expect(buildCfInnerRule("between", input("1", "9"), "greenDarkGreen")).toEqual({
      ok: true,
      inner: {
        type: "highlightCell",
        subType: "number",
        operator: "between",
        value: [1, 9],
        style: { bg: { rgb: "#C6EFCE" }, cl: { rgb: "#006100" } },
      },
    });
    expect(buildCfInnerRule("between", input("3", "3"), "redText").ok).toBe(true);
    expect(buildCfInnerRule("between", input("9", "1"), "redText")).toEqual({ ok: false, error: "invalidRange" });
    expect(buildCfInnerRule("between", input("1", ""), "redText")).toEqual({ ok: false, error: "invalidNumber" });
  });

  it("builds text contains and validates length", () => {
    expect(buildCfInnerRule("containsText", input("ab"), "yellowDarkYellow")).toEqual({
      ok: true,
      inner: {
        type: "highlightCell",
        subType: "text",
        operator: "containsText",
        value: "ab",
        style: { bg: { rgb: "#FFEB9C" }, cl: { rgb: "#9C5700" } },
      },
    });
    expect(buildCfInnerRule("containsText", input(""), "redText")).toEqual({ ok: false, error: "emptyText" });
    expect(buildCfInnerRule("containsText", input("x".repeat(256)), "redText")).toEqual({ ok: false, error: "textTooLong" });
    expect(buildCfInnerRule("containsText", input("x".repeat(255)), "redText").ok).toBe(true);
  });

  it("builds duplicate values without a value", () => {
    expect(buildCfInnerRule("duplicateValues", input(""), "lightRedFill")).toEqual({
      ok: true,
      inner: { type: "highlightCell", subType: "duplicateValues", style: { bg: { rgb: "#FFC7CE" } } },
    });
  });
});

describe("plain decimal numbers only", () => {
  it("refuses hex, exponent, Infinity and blank values like the DV dialog", () => {
    for (const raw of ["0x10", "1e3", "Infinity", " ", "1,5"]) {
      expect(buildCfInnerRule("greaterThan", input(raw), "redText")).toEqual({ ok: false, error: "invalidNumber" });
      expect(buildCfInnerRule("between", input("1", raw), "redText")).toEqual({ ok: false, error: "invalidNumber" });
    }
  });

  it("still accepts signed and fractional plain decimals", () => {
    expect(buildCfInnerRule("lessThan", input("-1.5"), "redText")).toMatchObject({ ok: true, inner: { value: -1.5 } });
    expect(buildCfInnerRule("lessThan", input(" 10 "), "redText")).toMatchObject({ ok: true, inner: { value: 10 } });
  });
});

describe("command params", () => {
  const range = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };

  it("wraps the inner rule with a unique cfId", () => {
    const inner = { type: "highlightCell", subType: "duplicateValues", style: cfStyleOf("redText") };
    const a = addRuleParams("u", "s", range, inner);
    const b = addRuleParams("u", "s", range, inner);
    expect(a).toEqual({
      unitId: "u",
      subUnitId: "s",
      rule: { cfId: expect.stringMatching(/^uw-cf-/), ranges: [range], stopIfTrue: false, rule: inner },
    });
    expect(a.rule.cfId).not.toBe(b.rule.cfId);
  });

  it("builds the clear params", () => {
    expect(clearRangeParams("u", "s", range)).toEqual({ unitId: "u", subUnitId: "s", ranges: [range] });
    expect(clearSheetParams("u", "s")).toEqual({ unitId: "u", subUnitId: "s" });
  });
});
