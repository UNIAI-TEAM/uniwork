import { describe, expect, it } from "vitest";
import { parseRuleSetDrops, ruleSetsDroppedError, withoutDroppedRuleSets, XLSX_RULE_SETS_DROPPED } from "./rule-set-drops";

const cf = (sheet: string) => ({ op: "set_conditional_formats", target: { sheet }, attributes: { rules: [] } });
const dv = (sheet: string) => ({ op: "set_data_validations", target: { sheet }, attributes: { rules: [] } });
const cell = { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 1 } };

describe("dropped rule-set refusal (X01 review r2 M-A)", () => {
  it("reads the engine reason as a job reason and inside an Electron IPC message", () => {
    const reason = 'xlsx_rule_sets_dropped:[["cf","Data"],["dv","Sổ 2"]]';
    const expected = [{ family: "conditionalFormats", sheet: "Data" }, { family: "dataValidations", sheet: "Sổ 2" }];
    expect(parseRuleSetDrops(reason)).toEqual(expected);
    expect(parseRuleSetDrops(`Error invoking remote method 'desktop:file-xlsx': XlsxTypedError: ${reason}`)).toEqual(expected);
  });

  it("is null for other failures and empty (generic notice) for a malformed payload", () => {
    expect(parseRuleSetDrops("unsupported_operation")).toBeNull();
    expect(parseRuleSetDrops(undefined)).toBeNull();
    for (const payload of ["{", '{"cf":"Data"}', '[["xx","Data"]]', '[["cf",""]]', `[["cf","${"x".repeat(32)}"]]`, '[["cf"]]', `[${'["cf","a"],'.repeat(80)}["cf","a"]]`]) {
      expect(parseRuleSetDrops(`xlsx_rule_sets_dropped:${payload}`), payload).toEqual([]);
    }
  });

  it("drops exactly the named rule-set ops and keeps every other edit", () => {
    const ops = [cf("Data"), dv("Data"), cf("Other"), cell];
    expect(withoutDroppedRuleSets(ops, [{ family: "conditionalFormats", sheet: "Data" }])).toEqual([dv("Data"), cf("Other"), cell]);
    const entries = ops.map((operation, revision) => ({ revision, operation }));
    expect(withoutDroppedRuleSets(entries, [{ family: "dataValidations", sheet: "Data" }], (entry) => entry.operation).map((entry) => entry.revision)).toEqual([0, 2, 3]);
    expect(withoutDroppedRuleSets(ops, [])).toEqual(ops);
  });

  it("fails the save with the non-terminal dropped code", () => {
    expect(ruleSetsDroppedError()).toMatchObject({ code: XLSX_RULE_SETS_DROPPED, errorClass: "engine" });
  });
});
