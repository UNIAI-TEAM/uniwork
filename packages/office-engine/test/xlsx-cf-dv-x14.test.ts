// X01 review M1: workbooks with Excel extended (x14) conditional formatting
// or data validation. The gateway's declarative CF/DV save fails closed on
// them, so the editor refuses CF/DV edits on such a sheet at edit time (the
// render model flags it, the renderer policy reads the flag) and never
// journals a snapshot there. These round-trips prove the engine half: the
// flags, a structural save that keeps the x14 parts, and the backstop that
// names a rule set that still fails at save and drops it so the next save
// goes through.
//
// Fixtures (test/fixtures/x14/README.md): derived from the G0
// xlsx-compatibility-edit.xlsx by swapping in worksheet XML in the exact shape
// Excel 365 writes for a data bar (base cfRule + linked x14 extension) and for
// a list validation that points at another sheet (x14:dataValidation).
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { applyXlsxEditBytes, createXlsxAdapter, readXlsxRenderModel, XlsxTypedError, type XlsxGatewayFunctions } from "../src/xlsx";
import { describeWithPatchedGateway, loadPatchedGateway } from "./xlsx-patched-gateway";
import { ruleSetDropReason } from "../src/xlsx/adapter-rule-sets";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const X14 = join(HERE, "fixtures", "x14");
const COMPAT_EDIT = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets", "xlsx-compatibility-edit.xlsx");

const bytesOf = (path: string) => new Uint8Array(readFileSync(path));
const dataBar = () => bytesOf(join(X14, "xlsx-x14-data-bar.xlsx"));
const x14Validation = () => bytesOf(join(X14, "xlsx-x14-data-validation.xlsx"));
const area = (startRow: number, endRow: number, startColumn: number, endColumn: number) => ({ startRow, endRow, startColumn, endColumn });
const SHEET1 = "xl/worksheets/sheet1.xml";
const BASE_BLOCK = /<conditionalFormatting sqref="([^"]+)"><cfRule type="dataBar"[\s\S]*?<\/conditionalFormatting>/;
const EXT_LST = /<extLst><ext uri="\{78C0D931[\s\S]*<\/extLst>/;
const X14_DV = /<extLst><ext uri="\{CCE6A557[\s\S]*<\/extLst>/;

/** What the renderer snapshotted before the fix: the loader-resolved data bar
 *  (numeric cfvos, gradient) next to a toolbar preset. */
const loaderSnapshot = {
  op: "set_conditional_formats",
  target: { sheet: "Data" },
  attributes: {
    rules: [
      { ranges: [area(1, 5, 1, 1)], stopIfTrue: false, rule: { type: "dataBar", isShowValue: true, config: { min: { type: "num", value: 20 }, max: { type: "num", value: 60 }, positiveColor: "#638EC6", isGradient: true } } },
      { ranges: [area(1, 5, 3, 3)], stopIfTrue: false, rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value: 9, style: { bg: { rgb: "#FFC7CE" } } } },
    ],
  },
};
const dvSnapshot = {
  op: "set_data_validations",
  target: { sheet: "Data" },
  attributes: { rules: [{ ranges: [area(1, 5, 3, 3)], rule: { type: "whole", operator: "greaterThan", formula1: "0" } }] },
};
const cellEdit = (cell: string, value: number) => ({ op: "set_cell", target: { sheet: "Data", cell }, attributes: { value } });

describeWithPatchedGateway("x14 conditional formatting and data validation", () => {
  let engine: XlsxGatewayFunctions;

  beforeAll(async () => {
    engine = await loadPatchedGateway();
  });

  async function session(source: Uint8Array) {
    const adapter = createXlsxAdapter({ engine });
    const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "x14" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    const ref = opened.document_model_ref;
    return {
      edit: (ops: readonly Record<string, unknown>[]) => adapter.edit(ref, ops),
      save: async () => (await adapter.serialize({ document_model_ref: ref, format: "xlsx" })).bytes,
    };
  }
  const sheetXml = async (bytes: Uint8Array) => (await engine.readEntryText(bytes, SHEET1)) ?? "";

  // Review r2 M-B / m-4: the parsed lists skip rules (no priority) and the
  // renderer loader skips more (timePeriod); the raw element count is what a
  // whole-sheet snapshot must match, so the renderer can refuse the family.
  it("counts every classic rule element, including the ones the parser and the loader skip", async () => {
    const classic = (await readXlsxRenderModel(engine, bytesOf(join(X14, "xlsx-classic-unsupported-cf.xlsx")))).sheets[0];
    expect(classic?.ruleCounts).toEqual({ conditionalFormats: 3, dataValidations: 1 });
    expect(classic?.conditionalRules?.length ?? 0).toBeLessThan(3);
    expect(classic?.x14ConditionalFormats).toBeUndefined();
    // x14 halves are not classic elements: only the data bar's base rule counts.
    expect((await readXlsxRenderModel(engine, dataBar())).sheets[0]?.ruleCounts).toEqual({ conditionalFormats: 1, dataValidations: 0 });
    expect((await readXlsxRenderModel(engine, x14Validation())).sheets[0]?.ruleCounts).toBeUndefined();
  });

  it("flags the sheets whose CF or DV the declarative save cannot rewrite", async () => {
    const bar = (await readXlsxRenderModel(engine, dataBar())).sheets[0];
    expect(bar).toMatchObject({ name: "Data", x14ConditionalFormats: true });
    expect(bar?.x14DataValidations).toBeUndefined();
    const dv = (await readXlsxRenderModel(engine, x14Validation())).sheets;
    expect(dv[0]).toMatchObject({ name: "Data", x14DataValidations: true });
    expect(dv[0]?.x14ConditionalFormats).toBeUndefined();
    expect(dv[1]?.x14DataValidations).toBeUndefined();
    const plain = (await readXlsxRenderModel(engine, bytesOf(COMPAT_EDIT))).sheets[0];
    expect(plain?.x14ConditionalFormats).toBeUndefined();
    expect(plain?.x14DataValidations).toBeUndefined();
  });

  it("keeps the data bar byte for byte through a cell edit, and through a row insert", async () => {
    const original = await sheetXml(dataBar());
    const block = BASE_BLOCK.exec(original)?.[0] ?? "";
    const extension = EXT_LST.exec(original)?.[0] ?? "";
    expect(block).toContain("<x14:id>");
    expect(extension).toContain("x14:dataBar");

    const edited = await session(dataBar());
    edited.edit([cellEdit("D2", 99)]);
    const afterEdit = await sheetXml(await edited.save());
    expect(afterEdit).toContain(block);
    expect(afterEdit).toContain(extension);

    // The renderer journals no CF snapshot on this sheet; the gateway's own
    // structural replay moves the base block's sqref.
    const inserted = await session(dataBar());
    inserted.edit([{ op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } }]);
    const afterInsert = await sheetXml(await inserted.save());
    expect(afterInsert).toContain(block.replace('sqref="B2:B6"', 'sqref="B3:B7"'));
    expect(afterInsert).toContain(extension);
  });

  it("names a CF snapshot the gateway refuses, drops it, and the next save keeps the data bar", async () => {
    const original = await sheetXml(dataBar());
    const doc = await session(dataBar());
    doc.edit([loaderSnapshot, cellEdit("D2", 7)]);
    const failure = await doc.save().then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(EngineBoundaryError);
    expect((failure as EngineBoundaryError).code).toBe("unsupported_operation");
    expect((failure as EngineBoundaryError).fields).toMatchObject({ rule_sets: [{ family: "conditionalFormats", ops: [0] }] });
    // r3 m-1: sheet names are document content and never ride an error field.
    expect(JSON.stringify((failure as EngineBoundaryError).fields)).not.toContain("Data");

    const saved = await sheetXml(await doc.save());
    expect(saved).toContain(BASE_BLOCK.exec(original)?.[0] ?? "missing");
    expect(saved).toContain(EXT_LST.exec(original)?.[0] ?? "missing");
    expect(saved).toMatch(/<c r="D2"[^>]*><v>7<\/v><\/c>/);
  });

  // Review r2 M-A: the real hosts save through one-shot jobs (a fresh adapter
  // per save), so the discard must ride the job's reason to the client, which
  // drops the named ops and saves again. Two consecutive jobs prove it.
  it("names the dropped rule sets in the one-shot job reason, and the trimmed op list then saves", async () => {
    const original = await sheetXml(dataBar());
    const ops = [loaderSnapshot, cellEdit("D2", 7)];
    const failure = await applyXlsxEditBytes(engine, undefined, dataBar(), ops).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(XlsxTypedError);
    expect((failure as XlsxTypedError).code).toBe("unsupported_operation");
    expect((failure as XlsxTypedError).reason).toBe('xlsx_rule_sets_dropped:[["cf",[0]]]');
    expect((failure as XlsxTypedError).message).not.toContain("Data");
    // The same op list fails again: a job keeps nothing between saves.
    await expect(applyXlsxEditBytes(engine, undefined, dataBar(), ops)).rejects.toBeInstanceOf(XlsxTypedError);

    // What the client runtime keeps after dropping the named set.
    const trimmed = ops.filter((_op, index) => index !== 0);
    const saved = await sheetXml((await applyXlsxEditBytes(engine, undefined, dataBar(), trimmed)).bytes);
    expect(saved).toContain(BASE_BLOCK.exec(original)?.[0] ?? "missing");
    expect(saved).toContain(EXT_LST.exec(original)?.[0] ?? "missing");
    expect(saved).toMatch(/<c r="D2"[^>]*><v>7<\/v><\/c>/);
  });

  // Review r3 MA-2: the reason names op positions, not sheet names, so a sheet
  // renamed after its rule edit still matches the ops the client sent.
  it("names every op folded into a refused state by position, across a rename, and the trimmed list then saves", async () => {
    const renamed = { ...loaderSnapshot, target: { sheet: "Doanh thu" } };
    const ops = [loaderSnapshot, { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Doanh thu" } }, renamed, { ...cellEdit("D2", 7), target: { sheet: "Doanh thu", cell: "D2" } }];
    const failure = await applyXlsxEditBytes(engine, undefined, dataBar(), ops).then(() => null, (error: unknown) => error);
    expect((failure as XlsxTypedError).reason).toBe('xlsx_rule_sets_dropped:[["cf",[0,2]]]');
    const saved = (await applyXlsxEditBytes(engine, undefined, dataBar(), [ops[1]!, ops[3]!])).bytes;
    expect(await engine.readEntryText(saved, SHEET1)).toMatch(/<c r="D2"[^>]*><v>7<\/v><\/c>/);
  });

  it("trims the dropped-rule-set reason to whole entries and bounded positions that fit the job channel", () => {
    expect(ruleSetDropReason([{ family: "dataValidations", ops: [3] }])).toBe('xlsx_rule_sets_dropped:[["dv",[3]]]');
    const many = Array.from({ length: 40 }, (_, index) => ({ family: "conditionalFormats" as const, ops: [1000 + index, 2000 + index] }));
    const reason = ruleSetDropReason(many);
    expect(reason.length).toBeLessThanOrEqual(300);
    const entries = JSON.parse(reason.slice("xlsx_rule_sets_dropped:".length)) as [string, number[]][];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(40);
    expect(entries[0]).toEqual(["cf", [1000, 2000]]);
    // One state folded from more positions than fit keeps its latest ones; the
    // next save names the rest.
    const long = ruleSetDropReason([{ family: "conditionalFormats", ops: Array.from({ length: 200 }, (_, index) => 10000 + index) }]);
    expect(long.length).toBeLessThanOrEqual(300);
    const [[, kept]] = JSON.parse(long.slice("xlsx_rule_sets_dropped:".length)) as [string, number[]][];
    expect(kept.at(-1)).toBe(10199);
  });

  it("names a DV snapshot on an x14-validation sheet, drops it, and the next save keeps the x14 rule", async () => {
    const original = await sheetXml(x14Validation());
    const doc = await session(x14Validation());
    doc.edit([dvSnapshot]);
    const failure = await doc.save().then(() => null, (error: unknown) => error);
    expect((failure as EngineBoundaryError).fields).toMatchObject({ rule_sets: [{ family: "dataValidations", ops: [0] }] });
    const saved = await sheetXml(await doc.save());
    expect(saved).toContain(X14_DV.exec(original)?.[0] ?? "missing");
    expect(saved).not.toContain("<dataValidations");
  });

  it("saves a saveable DV snapshot on a plain sheet without touching the backstop", async () => {
    const doc = await session(bytesOf(COMPAT_EDIT));
    doc.edit([dvSnapshot]);
    // A good rule set never reaches the backstop: the save simply succeeds.
    expect(await sheetXml(await doc.save())).toContain('<dataValidation type="whole" operator="greaterThan" sqref="D2:D6">');
  });
});
