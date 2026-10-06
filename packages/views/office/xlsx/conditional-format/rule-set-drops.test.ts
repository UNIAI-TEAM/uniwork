import { describe, expect, it } from "vitest";
import { parseRuleSetDrops, pendingDropIndexes, planRuleSetDrops, ruleSetDropMessage, ruleSetHistory, ruleSetsDroppedError, withoutOperationsAt, XLSX_RULE_SETS_DROPPED } from "./rule-set-drops";

const rule = (tag: string) => ({ ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }], stopIfTrue: false, rule: { tag } });
const cf = (sheet: string, tag = "x") => ({ op: "set_conditional_formats", target: { sheet }, attributes: { rules: [rule(tag)] } });
const dv = (sheet: string) => ({ op: "set_data_validations", target: { sheet }, attributes: { rules: [] } });
const rename = (sheet: string, newName: string) => ({ op: "rename_sheet", target: { sheet }, attributes: { newName } });
const cell = { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 1 } };
const duplicate = (sheet: string, name: string) => ({ op: "duplicate_sheet", target: { sheet }, attributes: { name } });

describe("dropped rule-set refusal (X01 review r2 M-A, r3 MA-2)", () => {
  it("reads op positions from a job reason and from inside an Electron IPC message", () => {
    const reason = 'xlsx_rule_sets_dropped:[["cf",[0,3]],["dv",[1]]]';
    const expected = [{ family: "conditionalFormats", ops: [0, 3] }, { family: "dataValidations", ops: [1] }];
    expect(parseRuleSetDrops(reason)).toEqual(expected);
    expect(parseRuleSetDrops(`Error invoking remote method 'desktop:file-xlsx': XlsxTypedError: ${reason}`)).toEqual(expected);
    expect(ruleSetDropMessage({ message: "office_job_failed", reason })).toBe(reason);
    expect(ruleSetDropMessage(new Error(reason))).toBe(reason);
  });

  it("is null for other failures and empty (generic notice) for a malformed or unbounded payload", () => {
    expect(parseRuleSetDrops("unsupported_operation")).toBeNull();
    expect(parseRuleSetDrops(undefined)).toBeNull();
    const many = JSON.stringify([["cf", Array.from({ length: 201 }, (_, index) => index)]]);
    for (const payload of ["{", '{"cf":[1]}', '[["xx",[1]]]', '[["cf",[]]]', '[["cf","Data"]]', '[["cf",[-1]]]', '[["cf",[1.5]]]', '[["cf",[20000]]]', '[["cf"]]', many]) {
      expect(parseRuleSetDrops(`xlsx_rule_sets_dropped:${payload}`), payload).toEqual([]);
    }
  });

  it("drops exactly the named positions of the sent list and names the sheet for the notice", () => {
    const sent = [cf("Data"), dv("Data"), cf("Other"), cell];
    const plan = planRuleSetDrops([{ family: "conditionalFormats", ops: [0] }], sent);
    expect(plan.indexes).toEqual([0]);
    expect(plan.drops).toEqual([{ family: "conditionalFormats", sheet: "Data", savedRules: null, rules: 1 }]);
    expect(withoutOperationsAt(sent, plan.indexes)).toEqual([dv("Data"), cf("Other"), cell]);
    const entries = sent.map((operation, revision) => ({ revision, operation }));
    expect(withoutOperationsAt(entries, [1]).map((entry) => entry.revision)).toEqual([0, 2, 3]);
  });

  it("matches a sheet renamed after its rule edit and names it by its live name (MA-2)", () => {
    const sent = [cf("Q1", "a"), rename("Q1", "Doanh thu"), cf("Doanh thu", "b"), cell];
    const plan = planRuleSetDrops([{ family: "conditionalFormats", ops: [0, 2] }], sent, [], [rename("Doanh thu", "Năm")]);
    expect(withoutOperationsAt(sent, plan.indexes)).toEqual([rename("Q1", "Doanh thu"), cell]);
    expect(plan.drops).toEqual([{ family: "conditionalFormats", sheet: "Năm", savedRules: null, rules: 1 }]);
  });

  it("restores the rules the last commit wrote, followed back through renames, or [] on a sheet added this session (MA-3)", () => {
    const committed = [cf("A", "saved"), rename("A", "B")];
    const plan = planRuleSetDrops([{ family: "conditionalFormats", ops: [0] }], [cf("B", "bad")], committed);
    expect(plan.drops[0]?.savedRules).toEqual([rule("saved")]);
    const added = planRuleSetDrops([{ family: "conditionalFormats", ops: [0] }], [cf("New", "bad")], [{ op: "add_sheet", attributes: { name: "New" } }]);
    expect(added.drops[0]?.savedRules).toEqual([]);
    const copy = planRuleSetDrops([{ family: "conditionalFormats", ops: [0] }], [cf("Copy", "bad")], [cf("A", "saved"), { op: "duplicate_sheet", target: { sheet: "A" }, attributes: { name: "Copy" } }]);
    expect(copy.drops[0]?.savedRules).toEqual([rule("saved")]);
    const otherFamily = planRuleSetDrops([{ family: "dataValidations", ops: [0] }], [dv("A")], [cf("A", "saved")]);
    expect(otherFamily.drops[0]?.savedRules).toBeNull();
  });

  it("drops the refused family's unsaved ops on every sheet when the positions do not match the sent list (r4 R4-4)", () => {
    const sent = [cf("Data", "a"), dv("Data"), rename("Data", "Q1"), cf("Other", "b"), cell];
    const later = [cf("Q1", "c"), dv("Other")];
    for (const ops of [[9], [4], [1]]) {
      const plan = planRuleSetDrops([{ family: "conditionalFormats", ops }], sent, [], later);
      expect(plan.indexes, JSON.stringify(ops)).toEqual([0, 3]);
      expect(plan.laterIndexes).toEqual([0]);
      expect(plan.drops).toEqual([
        { family: "conditionalFormats", sheet: "Q1", savedRules: null, rules: 1 },
        { family: "conditionalFormats", sheet: "Other", savedRules: null, rules: 1 },
      ]);
      // The other family, the rename and the cell edit stay; one more Save converges.
      expect(withoutOperationsAt([...sent, ...later], pendingDropIndexes(plan, sent.length))).toEqual([dv("Data"), rename("Data", "Q1"), cell, dv("Other")]);
    }
  });

  it("also drops a later snapshot of the refused sheet, followed through a rename, so one Save converges (r4 R4-3)", () => {
    const sent = [cf("Data", "bad"), cell];
    const later = [rename("Data", "Q1"), cf("Q1", "worse"), cf("Other", "fine"), dv("Q1")];
    const plan = planRuleSetDrops([{ family: "conditionalFormats", ops: [0] }], sent, [], later);
    expect(plan.indexes).toEqual([0]);
    expect(plan.laterIndexes).toEqual([1]);
    expect(plan.drops).toEqual([{ family: "conditionalFormats", sheet: "Q1", savedRules: null, rules: 1 }]);
  });

  it("drops only the copy's ops for a refused duplicated sheet and restores what the copy inherits (r4 R4-2)", () => {
    // The engine names the copy's state by its duplicate op (1) plus its own edit (2).
    const sent = [cf("A", "source"), duplicate("A", "B"), cf("B", "bad"), cell];
    const plan = planRuleSetDrops([{ family: "conditionalFormats", ops: [1, 2] }], sent);
    expect(plan.indexes).toEqual([2]);
    expect(plan.drops).toEqual([{ family: "conditionalFormats", sheet: "B", savedRules: [rule("source")], rules: 1 }]);
    // A copy of a sheet whose rules are the file's: null, the copy's inherited file rules.
    const fromFile = planRuleSetDrops([{ family: "conditionalFormats", ops: [1, 2] }], [cell, duplicate("A", "B"), cf("B", "bad")]);
    expect(fromFile.drops[0]?.savedRules).toBeNull();
  });

  it("converges on a copy-only refusal that names just the duplicate op: the family's ops are dropped", () => {
    const sent = [cf("A", "source"), duplicate("A", "B"), dv("A"), cell];
    const plan = planRuleSetDrops([{ family: "conditionalFormats", ops: [1] }], sent);
    expect(plan.indexes).toEqual([0]);
    expect(withoutOperationsAt(sent, plan.indexes)).toEqual([duplicate("A", "B"), dv("A"), cell]);
    // The copy inherited the dropped rules on screen: it is named and restored too.
    expect(plan.drops).toEqual([
      { family: "conditionalFormats", sheet: "A", savedRules: null, rules: 1 },
      { family: "conditionalFormats", sheet: "B", savedRules: null, rules: 1 },
    ]);
  });

  it("keeps only the ops a restore lookup reads from the committed history (r4 R4-1)", () => {
    const picture = { op: "set_visual", target: { sheet: "A" }, attributes: { image: "x".repeat(1000) } };
    const kept = [cf("A"), rename("A", "B"), { op: "add_sheet", attributes: { name: "N" } }, duplicate("B", "C"), dv("C")];
    expect(ruleSetHistory([picture, kept[0], cell, kept[1], kept[2], kept[3], kept[4]])).toEqual(kept);
  });

  it("fails the save with the non-terminal dropped code", () => {
    expect(ruleSetsDroppedError()).toMatchObject({ code: XLSX_RULE_SETS_DROPPED, errorClass: "engine" });
  });
});
