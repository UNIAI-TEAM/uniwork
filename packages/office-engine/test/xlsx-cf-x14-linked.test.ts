// UNI-953 option A (gateway patches 0011 + 0012) on a workbook saved by
// Microsoft Excel itself (fixtures/x14/xlsx-excel-data-bar.xlsx): two data
// bars, each a base <cfRule type="dataBar"> linked by x14:id to an x14 rule in
// the worksheet extLst (B2:B6, and the multi-area C2:C3 C5:C6), plus a classic
// cellIs > 9 on D2:D6. A whole-sheet CF snapshot keeps each linked rule
// verbatim when it carries a rule of the same type on the same areas (the
// renderer's loader rewrites data-bar cfvos, so no byte probe can match), a
// rule the snapshot dropped takes its x14 half with it, and a structural edit
// moves the x14 <xm:sqref> with the base block.
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyXlsxEditBytes, readXlsxRenderModel, type XlsxGatewayFunctions } from "../src/xlsx";
import { describeWithPatchedGateway, loadPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const excelDataBar = () => new Uint8Array(readFileSync(join(HERE, "fixtures", "x14", "xlsx-excel-data-bar.xlsx")));
const SHEET1 = "xl/worksheets/sheet1.xml";
const area = (startRow: number, endRow: number, startColumn: number, endColumn: number) => ({ startRow, endRow, startColumn, endColumn });

/** The two linked base blocks and the worksheet extLst as Excel wrote them. */
const BLOCK_B = /<conditionalFormatting sqref="B2:B6"><cfRule type="dataBar"[\s\S]*?<\/conditionalFormatting>/;
const BLOCK_C = /<conditionalFormatting sqref="C2:C3 C5:C6"><cfRule type="dataBar"[\s\S]*?<\/conditionalFormatting>/;
const EXT_LST = /<extLst><ext uri="\{78C0D931[\s\S]*<\/extLst>/;

/** A data bar as the renderer's loader installs it: numeric cfvos, gradient. */
const bar = (...ranges: ReturnType<typeof area>[]) => ({
  ranges,
  stopIfTrue: false,
  rule: { type: "dataBar", isShowValue: true, config: { min: { type: "num", value: 7 }, max: { type: "num", value: 45 }, positiveColor: "#638EC6", isGradient: true } },
});
const cellIs = (operator: string, value: number, ...ranges: ReturnType<typeof area>[]) => ({
  ranges,
  stopIfTrue: true,
  rule: { type: "highlightCell", subType: "number", operator, value, style: { bg: { rgb: "#FFC7CE" } } },
});
const snapshot = (...rules: unknown[]) => ({ op: "set_conditional_formats", target: { sheet: "Data" }, attributes: { rules } });
const rows = (op: "insert_rows" | "remove_rows", index: number, count: number) => ({ op, target: { sheet: "Data" }, attributes: { index, count } });

describeWithPatchedGateway("Excel linked x14 data bars under a CF snapshot (option A)", () => {
  let engine: XlsxGatewayFunctions;
  let original: string;

  beforeAll(async () => {
    engine = await loadPatchedGateway();
    original = (await engine.readEntryText(excelDataBar(), SHEET1)) ?? "";
  });

  const saved = async (ops: readonly Record<string, unknown>[]) =>
    (await engine.readEntryText((await applyXlsxEditBytes(engine, undefined, excelDataBar(), ops)).bytes, SHEET1)) ?? "";
  const part = (pattern: RegExp, xml: string) => pattern.exec(xml)?.[0] ?? "missing";

  it("is a real Excel file whose data bars the render model counts as classic base rules", async () => {
    expect(original).toContain("<x14:id>");
    expect(original).toContain("<xm:sqref>C2:C3 C5:C6</xm:sqref>");
    const sheet = (await readXlsxRenderModel(engine, excelDataBar())).sheets[0];
    expect(sheet?.ruleCounts).toEqual({ conditionalFormats: 3, dataValidations: 0 });
    expect(sheet?.x14DataValidations).toBeUndefined();
  });

  it("keeps both linked data bars byte for byte while a preset is added and the cellIs rule is edited", async () => {
    // Areas listed in another order than the file's sqref still match.
    const xml = await saved([
      snapshot(bar(area(4, 5, 2, 2), area(1, 2, 2, 2)), bar(area(1, 5, 1, 1)), cellIs("greaterThan", 10, area(1, 5, 3, 3)), cellIs("lessThan", 5, area(1, 5, 0, 0))),
    ]);
    expect(xml).toContain(part(BLOCK_B, original));
    expect(xml).toContain(part(BLOCK_C, original));
    expect(xml).toContain(part(EXT_LST, original));
    expect(xml).toMatch(/<conditionalFormatting sqref="D2:D6"><cfRule type="cellIs"[^>]*operator="greaterThan"[^>]*><formula>10<\/formula>/);
    expect(xml).toMatch(/<conditionalFormatting sqref="A2:A6"><cfRule type="cellIs"[^>]*operator="lessThan"/);
    expect(xml.match(/<cfRule type="dataBar"/g)).toHaveLength(2);
  });

  it("moves the base block and its x14 xm:sqref together on a row insert, with or without a snapshot", async () => {
    const shifted = await saved([rows("insert_rows", 0, 1)]);
    expect(shifted).toContain(part(BLOCK_B, original).replace('sqref="B2:B6"', 'sqref="B3:B7"'));
    expect(shifted).toContain("<xm:sqref>B3:B7</xm:sqref>");
    expect(shifted).toContain("<xm:sqref>C3:C4 C6:C7</xm:sqref>");
    expect(shifted).not.toContain("<xm:sqref>B2:B6</xm:sqref>");

    // The renderer's ref-range handler moves the snapshot the same way.
    const withSnapshot = await saved([
      rows("insert_rows", 0, 1),
      snapshot(bar(area(2, 6, 1, 1)), bar(area(2, 3, 2, 2), area(5, 6, 2, 2)), cellIs("greaterThan", 9, area(2, 6, 3, 3))),
    ]);
    expect(withSnapshot).toContain('<conditionalFormatting sqref="B3:B7"><cfRule type="dataBar"');
    expect(withSnapshot).toContain('<conditionalFormatting sqref="C3:C4 C6:C7"><cfRule type="dataBar"');
    expect(withSnapshot).toContain("<xm:sqref>B3:B7</xm:sqref>");
    expect(withSnapshot.match(/<cfRule type="dataBar"/g)).toHaveLength(2);
  });

  it("shrinks both halves on a partial row delete, down to a single-cell area", async () => {
    // Row 3 (index 2) goes: B2:B6 -> B2:B5, C2:C3 C5:C6 -> C2 C4:C5.
    const xml = await saved([
      rows("remove_rows", 2, 1),
      snapshot(bar(area(1, 4, 1, 1)), bar(area(1, 1, 2, 2), area(3, 4, 2, 2)), cellIs("greaterThan", 9, area(1, 4, 3, 3))),
    ]);
    expect(xml).toContain('<conditionalFormatting sqref="B2:B5"><cfRule type="dataBar"');
    expect(xml).toContain("<xm:sqref>B2:B5</xm:sqref>");
    expect(xml).toMatch(/<xm:sqref>C2(?::C2)? C4:C5<\/xm:sqref>/);
    expect(xml.match(/<cfRule type="dataBar"/g)).toHaveLength(2);
  });

  it("drops a removed linked rule with its x14 half and keeps the other", async () => {
    const xml = await saved([snapshot(bar(area(1, 2, 2, 2), area(4, 5, 2, 2)), cellIs("greaterThan", 9, area(1, 5, 3, 3)))]);
    const id = /<x14:id>([^<]+)<\/x14:id>/.exec(part(BLOCK_B, original))?.[1] ?? "missing";
    expect(xml).not.toContain('sqref="B2:B6"');
    expect(xml).not.toContain(id);
    expect(xml).not.toContain("<xm:sqref>B2:B6</xm:sqref>");
    expect(xml).toContain(part(BLOCK_C, original));
    expect(xml).toContain("<xm:sqref>C2:C3 C5:C6</xm:sqref>");
  });

  it("removes the x14 extension entirely once no linked rule is left", async () => {
    const xml = await saved([snapshot(cellIs("greaterThan", 9, area(1, 5, 3, 3)))]);
    expect(xml).not.toContain("dataBar");
    expect(xml).not.toContain("x14:conditionalFormatting");
    expect(xml).not.toContain("<extLst>");
    expect(xml).toMatch(/<conditionalFormatting sqref="D2:D6">/);
  });

  it("removes the x14 half when a row delete removes every cell of a data bar", async () => {
    // Rows 2-6 go: both data bars and the cellIs rule lose every cell.
    const xml = await saved([rows("remove_rows", 1, 5)]);
    expect(xml).not.toContain("<conditionalFormatting");
    expect(xml).not.toContain("x14:conditionalFormatting");
    expect(xml).not.toContain("<extLst>");
  });

  it("writes a classic data bar when the snapshot moves a linked rule to other cells", async () => {
    // A rule on new areas is no longer the linked one: the base block and the
    // x14 half go, and the snapshot's rule is written as a new classic rule.
    const xml = await saved([snapshot(bar(area(1, 5, 4, 4)), bar(area(1, 2, 2, 2), area(4, 5, 2, 2)), cellIs("greaterThan", 9, area(1, 5, 3, 3)))]);
    expect(xml).not.toContain("<xm:sqref>B2:B6</xm:sqref>");
    expect(xml).toMatch(/<conditionalFormatting sqref="E2:E6"><cfRule type="dataBar"/);
    expect(xml).toContain(part(BLOCK_C, original));
  });
});
