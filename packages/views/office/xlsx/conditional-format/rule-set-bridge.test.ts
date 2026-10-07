import { describe, expect, it } from "vitest";
import { rendererEditsToOperations, type XlsxGridEdit } from "../xlsx-edit-bridge";

const sheets = [{ id: "sheet-1", name: "Data" }];
const area = { startRow: 1, endRow: 9, startColumn: 0, endColumn: 0 };

describe("rule-set journal mapping (X01)", () => {
  it("maps a CF snapshot to set_conditional_formats with stopIfTrue normalized", () => {
    const rule = { type: "highlightCell", subType: "number", operator: "greaterThan", value: 10, style: { bg: { rgb: "#FFC7CE" } } };
    const edit: XlsxGridEdit = { sheetId: "sheet-1", ruleSet: "conditionalFormats", rules: [{ ranges: [area], rule }] };
    expect(rendererEditsToOperations(sheets, [edit])).toEqual([
      { op: "set_conditional_formats", target: { sheet: "Data" }, attributes: { rules: [{ ranges: [area], stopIfTrue: false, rule }] } },
    ]);
  });

  it("maps a DV snapshot to set_data_validations without a stopIfTrue field", () => {
    const rule = { uid: "dv-1", type: "list", formula1: "Yes,No", allowBlank: true };
    const edit: XlsxGridEdit = { sheetId: "sheet-1", ruleSet: "dataValidations", rules: [{ ranges: [area], rule }] };
    const [operation] = rendererEditsToOperations(sheets, [edit]);
    expect(operation).toEqual({ op: "set_data_validations", target: { sheet: "Data" }, attributes: { rules: [{ ranges: [area], rule }] } });
  });

  it("keeps an empty snapshot (it removes every rule) and prefers the live sheet name", () => {
    const edit: XlsxGridEdit = { sheetId: "sheet-1", sheetName: "Renamed", ruleSet: "dataValidations", rules: [] };
    expect(rendererEditsToOperations(sheets, [edit])).toEqual([
      { op: "set_data_validations", target: { sheet: "Renamed" }, attributes: { rules: [] } },
    ]);
  });

  it("copies the rule objects instead of aliasing the renderer's snapshot", () => {
    const rule = { type: "highlightCell", subType: "duplicateValues", style: { cl: { rgb: "#9C0006" } } };
    const edit: XlsxGridEdit = { sheetId: "sheet-1", ruleSet: "conditionalFormats", rules: [{ ranges: [area], stopIfTrue: true, rule }] };
    const [operation] = rendererEditsToOperations(sheets, [edit]);
    const mapped = (operation as { attributes: { rules: { rule: unknown; ranges: unknown[] }[] } }).attributes.rules[0]!;
    expect(mapped.rule).toEqual(rule);
    expect(mapped.rule).not.toBe(rule);
    expect(mapped.ranges[0]).not.toBe(area);
  });
});
