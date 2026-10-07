import { describe, expect, it } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import {
  addDvParams,
  buildDvRule,
  clearDvParams,
  isRealIsoDate,
  removeDvParams,
  selectionDvRange,
  updateDvCommands,
  XLSX_DV_EMPTY_FORM,
  type XlsxDvForm,
} from "./dv-commands";

const range = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 };
const form = (patch: Partial<XlsxDvForm>): XlsxDvForm => ({ ...XLSX_DV_EMPTY_FORM, ...patch });
const build = (patch: Partial<XlsxDvForm>) => buildDvRule(form(patch), range, "uid-1");

describe("buildDvRule", () => {
  it("builds a list rule with trimmed items, dropdown and optional error text", () => {
    expect(build({ type: "list", value1: " a , b,c ", errorTitle: " T ", error: " msg " })).toEqual({
      ok: true,
      rule: {
        uid: "uid-1",
        type: "list",
        formula1: "a,b,c",
        ranges: [range],
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: 1,
        error: "msg",
        errorTitle: "T",
        showDropDown: true,
      },
    });
  });

  it("omits error text when blank and generates a uid by default", () => {
    const built = buildDvRule(form({ type: "list", value1: "x" }), range);
    if (!built.ok) throw new Error("expected ok");
    expect(built.rule).not.toHaveProperty("error");
    expect(built.rule).not.toHaveProperty("errorTitle");
    expect(built.rule.uid).toMatch(/^uw-dv-/);
  });

  it.each([
    ["", "listEmpty"],
    ["a,,b", "listEmptyItem"],
    ["a,", "listEmptyItem"],
    ['a,"b"', "listBadChar"],
    [Array.from({ length: 100 }, () => "abcd").join(","), "listTooLong"],
  ])("rejects list source %j", (value1, code) => {
    expect(build({ type: "list", value1 })).toEqual({ ok: false, failure: { field: "value1", code } });
  });

  it("builds whole/decimal rules per operator with string formulas", () => {
    const built = build({ type: "whole", operator: "greaterThanOrEqual", value1: "10" });
    expect(built).toMatchObject({ ok: true, rule: { type: "whole", operator: "greaterThanOrEqual", formula1: "10" } });
    expect(built.ok && "formula2" in built.rule).toBe(false);
    expect(build({ type: "decimal", operator: "between", value1: "1.5", value2: "2.5" })).toMatchObject({
      ok: true,
      rule: { type: "decimal", operator: "between", formula1: "1.5", formula2: "2.5" },
    });
    expect(build({ type: "decimal", operator: "notBetween", value1: "1", value2: "5" })).toMatchObject({ ok: true });
  });

  it("rejects non-numbers, fractions for whole, and an inverted between", () => {
    expect(build({ type: "decimal", operator: "equal", value1: "abc" })).toEqual({
      ok: false,
      failure: { field: "value1", code: "numberRequired" },
    });
    expect(build({ type: "whole", operator: "equal", value1: "1.5" })).toEqual({
      ok: false,
      failure: { field: "value1", code: "wholeRequired" },
    });
    expect(build({ type: "whole", operator: "between", value1: "1", value2: "" })).toEqual({
      ok: false,
      failure: { field: "value2", code: "numberRequired" },
    });
    expect(build({ type: "whole", operator: "between", value1: "9", value2: "3" })).toEqual({
      ok: false,
      failure: { field: "value2", code: "rangeOrder" },
    });
  });

  it("builds date rules from real YYYY-MM-DD values", () => {
    expect(build({ type: "date", operator: "between", value1: "2026-01-01", value2: "2026-12-31" })).toMatchObject({
      ok: true,
      rule: { type: "date", formula1: "2026-01-01", formula2: "2026-12-31" },
    });
    expect(build({ type: "date", operator: "equal", value1: "2026-02-30" })).toEqual({
      ok: false,
      failure: { field: "value1", code: "dateRequired" },
    });
    expect(build({ type: "date", operator: "between", value1: "2026-05-02", value2: "2026-05-01" })).toEqual({
      ok: false,
      failure: { field: "value2", code: "rangeOrder" },
    });
  });

  it("enforces the Excel error text limits", () => {
    expect(build({ value1: "a", errorTitle: "x".repeat(33) })).toEqual({
      ok: false,
      failure: { field: "errorTitle", code: "titleTooLong" },
    });
    expect(build({ value1: "a", error: "x".repeat(256) })).toEqual({
      ok: false,
      failure: { field: "error", code: "messageTooLong" },
    });
    expect(build({ value1: "a", errorTitle: "x".repeat(32), error: "x".repeat(255) }).ok).toBe(true);
  });
});

describe("helpers", () => {
  it("validates calendar dates", () => {
    expect(isRealIsoDate("2024-02-29")).toBe(true);
    expect(isRealIsoDate("2025-02-29")).toBe(false);
    expect(isRealIsoDate("2025-1-1")).toBe(false);
  });

  it("derives an ordered range from the selection", () => {
    expect(selectionDvRange({ sheet: "S", address: "C4", endAddress: "A1" })).toEqual(range);
    expect(selectionDvRange({ sheet: "S", address: "B2" })).toEqual({ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 });
    expect(selectionDvRange(null)).toBeNull();
    expect(selectionDvRange({ sheet: "S", address: "not-an-address" })).toBeNull();
    expect(selectionDvRange({ sheet: "S", address: "A1", endAddress: "ZZZ1" })).toBeNull();
  });

  it("shapes the command params", () => {
    expect(clearDvParams("u", "s", range)).toEqual({ unitId: "u", subUnitId: "s", ranges: [range] });
    const built = build({ value1: "a" });
    if (!built.ok) throw new Error("expected ok");
    expect(addDvParams("u", "s", built.rule)).toEqual({ unitId: "u", subUnitId: "s", rule: built.rule });
  });

  it("applies the min <= max check to notBetween too", () => {
    expect(build({ type: "whole", operator: "notBetween", value1: "9", value2: "3" })).toEqual({
      ok: false,
      failure: { field: "value2", code: "rangeOrder" },
    });
    expect(build({ type: "whole", operator: "notBetween", value1: "3", value2: "9" })).toMatchObject({ ok: true });
  });
});

describe("error styles", () => {
  it("writes Univer's codes: stop 1, warning 2, information 0, and keeps showErrorMessage", () => {
    for (const [errorStyle, code] of [["stop", 1], ["warning", 2], ["information", 0]] as const) {
      expect(build({ type: "list", value1: "a", errorStyle })).toMatchObject({
        ok: true,
        rule: { errorStyle: code, showErrorMessage: true },
      });
    }
    expect(XLSX_DV_EMPTY_FORM.errorStyle).toBe("stop");
  });
});

describe("edit commands", () => {
  it("sends the changed setting and options with exact params, keeping the live flags (F4)", () => {
    const built = build({ type: "whole", operator: "between", value1: "1", value2: "5", errorStyle: "warning", error: "no" });
    if (!built.ok) throw new Error("expected ok");
    const live = { type: "list", formula1: "a,b", allowBlank: false, showErrorMessage: false, errorStyle: 1 };
    const steps = updateDvCommands("u", "s", "r1", built.rule, live);
    expect(steps).toEqual([
      {
        id: "sheets.command.update-data-validation-setting",
        params: { unitId: "u", subUnitId: "s", ruleId: "r1", setting: { type: "whole", operator: "between", formula1: "1", formula2: "5", allowBlank: false } },
      },
      {
        id: "sheets.command.update-data-validation-options",
        params: { unitId: "u", subUnitId: "s", ruleId: "r1", options: { errorStyle: 2, error: "no", errorTitle: "", showErrorMessage: false } },
      },
    ]);
    expect(removeDvParams("u", "s", "r1")).toEqual({ unitId: "u", subUnitId: "s", ruleId: "r1" });
  });
});

describe("edit commands skip what did not change (F3)", () => {
  const whole = { type: "whole" as const, operator: "between" as const, value1: "1", value2: "5", errorTitle: "", error: "", errorStyle: "stop" as const };
  it("sends nothing for an unchanged rule, Univer defaults included", () => {
    const built = build(whole);
    if (!built.ok) throw new Error("expected ok");
    // No operator stored = between; no error style = stop; no text = "".
    expect(updateDvCommands("u", "s", "r1", built.rule, { type: "whole", formula1: "1", formula2: "5" })).toEqual([]);
  });
  it("sends only the step that changed", () => {
    const style = build({ ...whole, errorStyle: "information" });
    const value = build({ ...whole, value2: "9" });
    if (!style.ok || !value.ok) throw new Error("expected ok");
    const live = { type: "whole", operator: "between", formula1: "1", formula2: "5", errorStyle: 1, allowBlank: true };
    expect(updateDvCommands("u", "s", "r1", style.rule, live).map((step) => step.id)).toEqual(["sheets.command.update-data-validation-options"]);
    expect(updateDvCommands("u", "s", "r1", value.rule, live).map((step) => step.id)).toEqual(["sheets.command.update-data-validation-setting"]);
  });
});

describe("review fixes stay fixed", () => {
  it("refuses hex and exponent numbers, and words notBetween as 'không nằm giữa'", () => {
    for (const raw of ["0x10", "1e3"]) {
      expect(build({ type: "decimal", operator: "equal", value1: raw })).toMatchObject({ ok: false });
    }
    expect((viLocale as { office: { xlsx: { dataValidation: { operators: Record<string, string> } } } }).office.xlsx.dataValidation.operators.notBetween).toBe(
      "không nằm giữa",
    );
  });
});
