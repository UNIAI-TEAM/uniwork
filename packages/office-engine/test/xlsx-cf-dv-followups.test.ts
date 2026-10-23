// UNI-953 X01 follow-ups on the patched gateway, re-read through the render
// model the editor opens: the "Unique values" preset, DV warning and
// information styles end to end (op -> engine -> gateway -> reopen), and the
// duplicate-sheet path (review dv-cf m5): a copy carries the source's rules, a
// rule-less copy snapshot clears only the copy, and the source is untouched.
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createXlsxAdapter, readXlsxRenderModel, type XlsxGatewayFunctions } from "../src/xlsx";
import { describeWithPatchedGateway, loadPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const COMPAT_EDIT = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets", "xlsx-compatibility-edit.xlsx");

const area = (startRow: number, endRow: number, startColumn: number, endColumn: number) => ({ startRow, endRow, startColumn, endColumn });
const cfItem = (rules: readonly unknown[], sheet = "Data") => ({ op: "set_conditional_formats", target: { sheet }, attributes: { rules } });
const dvItem = (rules: readonly unknown[], sheet = "Data") => ({ op: "set_data_validations", target: { sheet }, attributes: { rules } });
const style = { bg: { rgb: "#FFC7CE" }, cl: { rgb: "#9C0006" } };
const greaterThan = { ranges: [area(1, 9, 1, 1)], stopIfTrue: false, rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value: 10, style } };
const unique = { ranges: [area(1, 9, 0, 0)], stopIfTrue: false, rule: { type: "highlightCell", subType: "uniqueValues", style } };
const whole = (errorStyle: number, column: number) => ({
  ranges: [area(1, 9, column, column)],
  rule: { type: "whole", operator: "between", formula1: "1", formula2: "5", showErrorMessage: true, errorStyle, errorTitle: "Kiểm tra", error: "Từ 1 đến 5" },
});

describeWithPatchedGateway("xlsx CF/DV follow-ups on the patched gateway", () => {
  let engine: XlsxGatewayFunctions;

  beforeAll(async () => {
    engine = await loadPatchedGateway();
  });

  async function saveOps(source: Uint8Array, ops: readonly Record<string, unknown>[]) {
    const adapter = createXlsxAdapter({ engine });
    const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "cf-dv-followups" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    adapter.edit(opened.document_model_ref, ops);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    adapter.release(opened.document_model_ref);
    return saved.bytes;
  }
  const fixture = () => new Uint8Array(readFileSync(COMPAT_EDIT));
  const sheetOf = async (bytes: Uint8Array, name: string) => (await readXlsxRenderModel(engine, bytes)).sheets.find((sheet) => sheet.name === name);

  it("writes the Unique values preset and reopens it", async () => {
    const saved = await saveOps(fixture(), [cfItem([unique])]);
    expect(await engine.readEntryText(saved, "xl/worksheets/sheet1.xml")).toMatch(/<conditionalFormatting sqref="A2:A10"><cfRule type="uniqueValues" dxfId="\d+" priority="1"\/?>/);
    expect((await sheetOf(saved, "Data"))?.conditionalRules).toEqual([expect.objectContaining({ ruleType: "uniqueValues", ranges: [area(1, 9, 0, 0)] })]);
  });

  it("writes stop, warning and information validations and reopens each style", async () => {
    const saved = await saveOps(fixture(), [dvItem([whole(1, 3), whole(2, 4), whole(0, 5)])]);
    const xml = (await engine.readEntryText(saved, "xl/worksheets/sheet1.xml")) ?? "";
    expect(xml).toMatch(/<dataValidation type="whole"(?![^>]*errorStyle)[^>]*sqref="D2:D10">/);
    expect(xml).toMatch(/<dataValidation type="whole"[^>]*errorStyle="warning"[^>]*sqref="E2:E10">/);
    expect(xml).toMatch(/<dataValidation type="whole"[^>]*errorStyle="information"[^>]*sqref="F2:F10">/);
    const rules = (await sheetOf(saved, "Data"))?.dataValidations ?? [];
    const byColumn = (column: number) => rules.find((rule) => rule.ranges[0]?.startColumn === column);
    expect(byColumn(3)?.errorStyle).toBeUndefined();
    expect(byColumn(4)).toMatchObject({ errorStyle: "warning", errorTitle: "Kiểm tra", error: "Từ 1 đến 5", showErrorMessage: true });
    expect(byColumn(5)).toMatchObject({ errorStyle: "information" });
  });

  it("duplicates a sheet with its CF and DV, and the copy reopens with both", async () => {
    const source = await saveOps(fixture(), [cfItem([greaterThan]), dvItem([whole(2, 3)])]);
    const saved = await saveOps(source, [{ op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } }]);
    for (const name of ["Data", "Data copy"]) {
      const sheet = await sheetOf(saved, name);
      expect(sheet?.conditionalRules, name).toEqual([expect.objectContaining({ ruleType: "cellIs", operator: "greaterThan", formulas: ["10"] })]);
      expect(sheet?.dataValidations, name).toEqual([expect.objectContaining({ ruleType: "whole", errorStyle: "warning" })]);
    }
  });

  it("a rule-less snapshot of the copy clears only the copy's family; the source keeps its rules", async () => {
    const source = await saveOps(fixture(), [cfItem([greaterThan]), dvItem([whole(1, 3)])]);
    const saved = await saveOps(source, [
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
      cfItem([], "Data copy"),
    ]);
    const copy = await sheetOf(saved, "Data copy");
    expect(copy?.conditionalRules ?? []).toEqual([]);
    expect(copy?.dataValidations).toHaveLength(1);
    const data = await sheetOf(saved, "Data");
    expect(data?.conditionalRules).toHaveLength(1);
    expect(data?.dataValidations).toHaveLength(1);
  });

  it("a copy's own snapshot (the copied rule plus a new one) saves on the copy only", async () => {
    const source = await saveOps(fixture(), [cfItem([greaterThan])]);
    const saved = await saveOps(source, [
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
      cfItem([greaterThan, unique], "Data copy"),
    ]);
    expect((await sheetOf(saved, "Data copy"))?.conditionalRules?.map((rule) => rule.ruleType).sort()).toEqual(["cellIs", "uniqueValues"]);
    expect((await sheetOf(saved, "Data"))?.conditionalRules?.map((rule) => rule.ruleType)).toEqual(["cellIs"]);
  });
});
