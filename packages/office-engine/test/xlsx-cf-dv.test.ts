// Conditional formatting + data validation (X01). The parser/model half runs
// anywhere; the round-trips save through the patched gateway artifact
// (xlsx-patched-gateway.ts) and re-read the saved bytes
// through the render model the editor opens, so "open -> apply -> save ->
// reopen shows the rules" is proven on real OOXML.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createXlsxAdapter,
  createXlsxSessionModel,
  parseXlsxOps,
  readXlsxRenderModel,
  XlsxOpError,
  type XlsxGatewayFunctions,
  type XlsxWorkbookSnapshot,
} from "../src/xlsx";
import { parseDataValidations } from "../src/xlsx/render-model-validations";
import { describeWithPatchedGateway, loadPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const COMPAT_EDIT = "xlsx-compatibility-edit.xlsx";

const area = (startRow: number, endRow: number, startColumn: number, endColumn: number) => ({ startRow, endRow, startColumn, endColumn });
const cfItem = (rules: readonly Record<string, unknown>[], sheet = "Data") => ({ op: "set_conditional_formats", target: { sheet }, attributes: { rules } });
const dvItem = (rules: readonly Record<string, unknown>[], sheet = "Data") => ({ op: "set_data_validations", target: { sheet }, attributes: { rules } });
const greaterThan = (value: number) => ({
  ranges: [area(1, 20, 1, 1)],
  stopIfTrue: false,
  rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value, style: { bg: { rgb: "#FFC7CE" }, cl: { rgb: "#9C0006" } } },
});
const yesNo = { ranges: [area(1, 20, 2, 2)], rule: { uid: "dv-1", type: "list", formula1: "Yes,No", allowBlank: true, showDropDown: true, showErrorMessage: true, errorStyle: 1, error: "Chọn Yes hoặc No" } };

const baseSnapshot = (): XlsxWorkbookSnapshot => ({
  revision: 0,
  sheets: [
    { id: "sheet-1", name: "Data", cells: { A1: { value: 2 } } },
    { id: "sheet-2", name: "Report", cells: {} },
  ],
});

function modelWith(operations: unknown[]) {
  const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
  for (const op of parseXlsxOps(operations, model.resolver({ "sheet-1": "Data", "sheet-2": "Report" }))) model.applyEdit(op);
  return model;
}

function refusal(operation: unknown): XlsxOpError | undefined {
  try {
    modelWith([operation]);
  } catch (error) {
    return error as XlsxOpError;
  }
  return undefined;
}

describe("XLSX CF/DV ops in the session model", () => {
  it("folds each family per sheet, last write wins, in first-touch order", () => {
    const model = modelWith([
      dvItem([yesNo], "Report"),
      cfItem([greaterThan(5)]),
      cfItem([greaterThan(10)]),
      dvItem([]),
    ]);
    expect(model.pendingConditionalFormatStates()).toEqual([{ sheetName: "Data", rules: [greaterThan(10)] }]);
    expect(model.pendingDataValidationStates()).toEqual([
      { sheetName: "Report", rules: [yesNo] },
      { sheetName: "Data", rules: [] },
    ]);
    expect(model.isDirty).toBe(true);
  });

  it("moves rule sets with a rename, clones them with a duplicate and drops them with a removal", () => {
    const renamed = modelWith([cfItem([greaterThan(1)]), { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } }]);
    expect(renamed.pendingConditionalFormatStates().map((state) => state.sheetName)).toEqual(["Budget"]);

    const duplicated = modelWith([dvItem([yesNo]), { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } }]);
    expect(duplicated.pendingDataValidationStates().map((state) => state.sheetName)).toEqual(["Data", "Data copy"]);

    const removed = modelWith([cfItem([greaterThan(1)]), { op: "remove_sheet", target: { sheet: "Data" } }]);
    expect(removed.pendingConditionalFormatStates()).toEqual([]);
    // Undo of the removal (an add of the same name) resurrects the snapshot.
    for (const op of parseXlsxOps([{ op: "add_sheet", attributes: { name: "Data" } }], removed.resolver({}))) removed.applyEdit(op);
    expect(removed.pendingConditionalFormatStates()).toEqual([{ sheetName: "Data", rules: [greaterThan(1)] }]);
  });

  it("rolls back to a checkpoint and drains on rebase", () => {
    const model = modelWith([cfItem([greaterThan(1)])]);
    const checkpoint = model.checkpoint();
    for (const op of parseXlsxOps([dvItem([yesNo])], model.resolver({ "sheet-1": "Data" }))) model.applyEdit(op);
    model.rollback(checkpoint);
    expect(model.pendingDataValidationStates()).toEqual([]);
    expect(model.pendingConditionalFormatStates()).toHaveLength(1);
    model.rebase(baseSnapshot(), "sha-next");
    expect(model.pendingConditionalFormatStates()).toEqual([]);
  });

  it("deep-copies the rule JSON so later renderer mutation cannot alias the journal", () => {
    const rule = greaterThan(3);
    const model = modelWith([cfItem([rule])]);
    (rule.rule.style.bg as { rgb: string }).rgb = "#000000";
    expect(model.pendingConditionalFormatStates()[0]?.rules[0]?.rule).toMatchObject({ style: { bg: { rgb: "#FFC7CE" } } });
  });

  it("refuses unsaveable or malformed snapshots before they reach the model", () => {
    expect(refusal(cfItem([{ ...greaterThan(1), rule: { type: "formula" } }]))?.field).toBe("attributes.rules.rule.type");
    expect(refusal(dvItem([{ ...yesNo, rule: { type: "listMultiple" } }]))?.field).toBe("attributes.rules.rule.type");
    expect(refusal(cfItem([{ ...greaterThan(1), ranges: [] }]))?.field).toBe("attributes.rules.ranges");
    expect(refusal(cfItem([{ ...greaterThan(1), ranges: [area(4, 2, 0, 0)] }]))?.field).toBe("attributes.rules.ranges");
    expect(refusal(dvItem([{ ...yesNo, ranges: [area(0, 0, 0, 16_384)] }]))?.field).toBe("attributes.rules.ranges");
    expect(refusal(cfItem([{ ...greaterThan(1), stopIfTrue: "yes" }]))?.field).toBe("attributes.rules.stopIfTrue");
    expect(refusal(dvItem([1]))?.field).toBe("attributes.rules");
    expect(refusal({ op: "set_data_validations", target: { sheet: "Data" }, attributes: {} })?.field).toBe("attributes.rules");
    expect(refusal(cfItem(Array.from({ length: 1_001 }, () => greaterThan(1))))?.field).toBe("attributes.rules");
    expect(refusal(dvItem([{ ...yesNo, rule: { type: "list", formula1: "x".repeat(70_000) } }]))?.field).toBe("attributes.rules.rule");
    expect(refusal(cfItem([greaterThan(1)], "Missing"))).toBeInstanceOf(XlsxOpError);
  });

  // Review m2: every shape the gateway's serializers throw on is refused at
  // edit time, so an unsaveable snapshot never reaches the journal.
  it("refuses inner rule shapes the gateway serializers cannot write", () => {
    const cf = (rule: Record<string, unknown>) => refusal(cfItem([{ ...greaterThan(1), rule: { style: {}, ...rule } }]))?.field;
    const dv = (rule: Record<string, unknown>) => refusal(dvItem([{ ...yesNo, rule }]))?.field;
    const CF_FIELD = "attributes.rules.rule";
    expect(cf({ type: "highlightCell", subType: "timePeriod", operator: "yesterday" })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "average", operator: "equal" })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "number", operator: "approximately", value: 1 })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "number", operator: 'greaterThan" x="1', value: 1 })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "number", operator: "between", value: [1, "2"] })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "number", operator: "greaterThan" })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "text", operator: "matchesRegex", value: "a" })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "rank", value: "ten" })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "formula", value: "" })).toBe(CF_FIELD);
    expect(cf({ type: "highlightCell", subType: "sparkle" })).toBe(CF_FIELD);
    expect(cf({ type: "colorScale", config: [{ index: 0 }] })).toBe(CF_FIELD);
    expect(cf({ type: "dataBar" })).toBe(CF_FIELD);
    expect(cf({ type: "iconSet", config: [] })).toBe(CF_FIELD);
    expect(dv({ type: "whole", operator: "approximately", formula1: "1" })).toBe(CF_FIELD);
    expect(dv({ type: "list", formula1: "a", errorStyle: 7 })).toBe(CF_FIELD);

    // Everything the toolbar, undo and the file's own rules produce still parses.
    expect(refusal(cfItem([
      greaterThan(1),
      { ...greaterThan(1), rule: { type: "highlightCell", subType: "number", operator: "between", value: [1, 5], style: {} } },
      { ...greaterThan(1), rule: { type: "highlightCell", subType: "text", operator: "containsText", value: "x", style: {} } },
      { ...greaterThan(1), rule: { type: "highlightCell", subType: "duplicateValues", style: {} } },
      { ...greaterThan(1), rule: { type: "highlightCell", subType: "average", operator: "lessThanOrEqual", style: {} } },
      { ...greaterThan(1), rule: { type: "highlightCell", subType: "rank", value: 10, style: {} } },
      { ...greaterThan(1), rule: { type: "highlightCell", subType: "formula", value: "=A1>0", style: {} } },
      { ...greaterThan(1), rule: { type: "colorScale", config: [{ index: 0 }, { index: 1 }] } },
      { ...greaterThan(1), rule: { type: "dataBar", config: { min: { type: "min" }, max: { type: "max" } } } },
    ]))).toBeUndefined();
    expect(refusal(dvItem([
      yesNo,
      { ...yesNo, rule: { type: "whole", operator: "notBetween", formula1: "1", formula2: "9", errorStyle: 2 } },
      { ...yesNo, rule: { type: "any", prompt: "Hi" } },
    ]))).toBeUndefined();
  });
});

describe("worksheet data-validation reader", () => {
  const parseRange = (ref: string) => {
    const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
    if (!match) return null;
    const column = (letters: string) => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    return { startRow: Number(match[2]) - 1, endRow: Number(match[4] ?? match[2]) - 1, startColumn: column(match[1]!), endColumn: column(match[3] ?? match[1]!) };
  };

  it("reads classic rules field for field like the sidecar's parse_dv_rule", () => {
    const xml = `<worksheet><sheetData/><dataValidations count="2">` +
      `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" error="Pick &quot;Yes&quot;" sqref="C2:C21 E5"><formula1>"Yes,No"</formula1></dataValidation>` +
      `<dataValidation type="whole" operator="between" showDropDown="1" sqref="B2"><formula1>1</formula1><formula2>10</formula2></dataValidation>` +
      `</dataValidations><extLst><ext><x14:dataValidations><x14:dataValidation type="list"><xm:sqref>A1</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst></worksheet>`;
    expect(parseDataValidations(xml, parseRange)).toEqual([
      {
        ranges: [area(1, 20, 2, 2), area(4, 4, 4, 4)], ruleType: "list", formulas: ['"Yes,No"'],
        allowBlank: true, suppressDropdown: false, showInputMessage: false, showErrorMessage: true,
        errorStyle: "warning", error: 'Pick "Yes"',
      },
      {
        ranges: [area(1, 1, 1, 1)], ruleType: "whole", operator: "between", formulas: ["1", "10"],
        allowBlank: false, suppressDropdown: true, showInputMessage: false, showErrorMessage: false,
      },
    ]);
  });

  it("reads a rule without a type as 'none' and skips one without a range", () => {
    const xml = `<dataValidations><dataValidation showInputMessage="1" prompt="Hi" sqref="A1"/><dataValidation type="whole"/></dataValidations>`;
    expect(parseDataValidations(xml, parseRange)).toEqual([
      { ranges: [area(0, 0, 0, 0)], ruleType: "none", formulas: [], allowBlank: false, suppressDropdown: false, showInputMessage: true, showErrorMessage: false, prompt: "Hi" },
    ]);
  });
});

describeWithPatchedGateway("CF/DV round-trip on the vendored gateway", () => {
  let engine: XlsxGatewayFunctions;

  beforeAll(async () => {
    engine = await loadPatchedGateway();
  });

  async function saveOps(source: Uint8Array, ops: readonly Record<string, unknown>[]) {
    const adapter = createXlsxAdapter({ engine });
    const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "cf-dv" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    adapter.edit(opened.document_model_ref, ops);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    adapter.release(opened.document_model_ref);
    return saved.bytes;
  }
  const fixture = () => new Uint8Array(readFileSync(join(FIXTURES, COMPAT_EDIT)));

  it("writes <conditionalFormatting> and <dataValidations> and the reopened model shows both", async () => {
    const saved = await saveOps(fixture(), [cfItem([greaterThan(10)]), dvItem([yesNo])]);
    const sheetXml = await engine.readEntryText(saved, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toMatch(/<conditionalFormatting sqref="B2:B21"><cfRule type="cellIs" dxfId="\d+" priority="1" operator="greaterThan"><formula>10<\/formula><\/cfRule><\/conditionalFormatting>/);
    expect(sheetXml).toContain('<dataValidation type="list" allowBlank="1" showErrorMessage="1" error="Chọn Yes hoặc No" sqref="C2:C21"><formula1>"Yes,No"</formula1></dataValidation>');
    const styles = await engine.readEntryText(saved, "xl/styles.xml");
    expect(styles).toMatch(/<dxfs count="\d+">[\s\S]*FFC7CE/);

    const reopened = await readXlsxRenderModel(engine, saved);
    const data = reopened.sheets.find((sheet) => sheet.name === "Data");
    expect(data?.conditionalRules).toEqual([
      expect.objectContaining({ ruleType: "cellIs", operator: "greaterThan", formulas: ["10"], ranges: [area(1, 20, 1, 1)] }),
    ]);
    expect(data?.dataValidations).toEqual([
      expect.objectContaining({ ruleType: "list", formulas: ['"Yes,No"'], allowBlank: true, showErrorMessage: true, error: "Chọn Yes hoặc No", ranges: [area(1, 20, 2, 2)] }),
    ]);
  });

  it("writes the five Highlight Cells presets the toolbar builds", async () => {
    const style = { bg: { rgb: "#C6EFCE" }, cl: { rgb: "#006100" } };
    const presets = [
      { type: "highlightCell", subType: "number", operator: "lessThan", value: 0, style },
      { type: "highlightCell", subType: "number", operator: "between", value: [1, 5], style },
      { type: "highlightCell", subType: "text", operator: "containsText", value: "Hà Nội", style },
      { type: "highlightCell", subType: "duplicateValues", style },
    ].map((rule, index) => ({ ranges: [area(1, 9, index, index)], stopIfTrue: false, rule }));
    const saved = await saveOps(fixture(), [cfItem([greaterThan(1), ...presets])]);
    const sheetXml = await engine.readEntryText(saved, "xl/worksheets/sheet1.xml") ?? "";
    for (const fragment of ['operator="greaterThan"', 'operator="lessThan"', 'operator="between"', 'type="containsText"', 'text="Hà Nội"', 'type="duplicateValues"']) {
      expect(sheetXml).toContain(fragment);
    }
    expect((await readXlsxRenderModel(engine, saved)).sheets[0]?.conditionalRules).toHaveLength(5);
  });

  it("writes number and date validations with their operators and removes every rule with an empty snapshot", async () => {
    const saved = await saveOps(fixture(), [dvItem([
      { ranges: [area(1, 9, 3, 3)], rule: { type: "whole", operator: "between", formula1: "1", formula2: "10", showErrorMessage: true, errorStyle: 1 } },
      { ranges: [area(1, 9, 4, 4)], rule: { type: "decimal", operator: "greaterThan", formula1: "0.5" } },
      { ranges: [area(1, 9, 5, 5)], rule: { type: "date", operator: "lessThan", formula1: "2026-12-31" } },
    ])]);
    const sheetXml = await engine.readEntryText(saved, "xl/worksheets/sheet1.xml") ?? "";
    expect(sheetXml).toContain('<dataValidation type="whole" showErrorMessage="1" sqref="D2:D10"><formula1>1</formula1><formula2>10</formula2></dataValidation>');
    expect(sheetXml).toContain('<dataValidation type="decimal" operator="greaterThan" sqref="E2:E10"><formula1>0.5</formula1></dataValidation>');
    expect(sheetXml).toContain('<dataValidation type="date" operator="lessThan" sqref="F2:F10"><formula1>46387</formula1></dataValidation>');
    const cleared = await saveOps(saved, [dvItem([])]);
    expect(await engine.readEntryText(cleared, "xl/worksheets/sheet1.xml")).not.toContain("<dataValidations");
  });
});
