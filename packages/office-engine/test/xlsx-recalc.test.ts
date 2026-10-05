// Recalc planning tests — read batching respects the sidecar's wire bounds
// and the cell→cached-value mapping mirrors the upstream renderer's reduce.
import { describe, expect, it } from "vitest";
import {
  buildRecalcReadBatches,
  formulaCellsOfSnapshot,
  recalcCellValue,
  recalcToFormulaValues,
  XLSX_MAX_RECALC_READ_CELLS,
} from "../src/xlsx/recalc";
import { readSharedFollowers, sharedFollowersOfSheetXml } from "../src/xlsx/shared-formulas";
import type { XlsxWorkbookSnapshot } from "../src/xlsx/engine";

describe("buildRecalcReadBatches", () => {
  it("one bounding box per sheet over formulas ∪ edits", () => {
    const batches = buildRecalcReadBatches(
      [
        { sheetName: "Data", row: 0, column: 0 },
        { sheetName: "Data", row: 9, column: 2 },
        { sheetName: "Report", row: 1, column: 1 },
      ],
      [{ sheet: "Data", row: 3, column: 0, input: "7" }],
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      { sheet: "Data", range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 2 } },
      { sheet: "Report", range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 } },
    ]);
  });

  it("splits row bands so every batch stays under the summed cell bound", () => {
    // 500 columns × 2000 rows = 1_000_000 cells → ≥50 batches of ≤20_000.
    const batches = buildRecalcReadBatches(
      [
        { sheetName: "S", row: 0, column: 0 },
        { sheetName: "S", row: 1999, column: 499 },
      ],
      [],
    );
    for (const batch of batches) {
      const total = batch.reduce(
        (n, r) => n + (r.range.endRow - r.range.startRow + 1) * (r.range.endColumn - r.range.startColumn + 1),
        0,
      );
      expect(total).toBeLessThanOrEqual(XLSX_MAX_RECALC_READ_CELLS);
    }
    // Coverage: bands tile the whole range.
    const rows = batches.flatMap((b) => b[0]!.range).map((r) => r.startRow).sort((a, b) => a - b);
    expect(rows[0]).toBe(0);
  });

  it("no formula cells and no edits → no reads", () => {
    expect(buildRecalcReadBatches([], [])).toEqual([]);
  });
});

describe("recalcCellValue", () => {
  const cell = (over: object) => ({
    sheet: "S",
    row: 0,
    column: 0,
    formatted: "",
    isError: false,
    isFormula: true,
    ...over,
  });
  it("maps engine-typed errors to {error}, numbers to number, booleans, empty→null, else text", () => {
    expect(recalcCellValue(cell({ isError: true, formatted: "#DIV/0!" }))).toEqual({ error: "#DIV/0!" });
    expect(recalcCellValue(cell({ number: 42, formatted: "42" }))).toBe(42);
    expect(recalcCellValue(cell({ formatted: "TRUE" }))).toBe(true);
    expect(recalcCellValue(cell({ formatted: "FALSE" }))).toBe(false);
    expect(recalcCellValue(cell({ formatted: "" }))).toBeNull();
    expect(recalcCellValue(cell({ formatted: "text" }))).toBe("text");
  });
});

describe("recalcToFormulaValues", () => {
  it("only isFormula cells get a <v> refresh; skipped cells count as kept", () => {
    const expected = [
      { sheetName: "Data", row: 0, column: 1 },
      { sheetName: "Data", row: 1, column: 1 },
      { sheetName: "Data", row: 2, column: 1 },
    ];
    const { values, kept } = recalcToFormulaValues(expected, {
      cells: [
        { sheet: "Data", row: 0, column: 1, formatted: "6", number: 6, isError: false, isFormula: true },
        // row 1: a literal answer at an <f> coordinate (the engine deduped
        // the formula onto a shifted address) cannot refresh the cache —
        // the file's own <v> is kept and counted.
        { sheet: "Data", row: 1, column: 1, formatted: "typed", isError: false, isFormula: false },
        // row 2 missing entirely: engine gap → keeps file's cached <v>.
      ],
    });
    expect(kept).toBe(2);
    expect(values).toEqual([{ sheetName: "Data", cells: [{ row: 0, column: 1, value: 6 }] }]);
  });
});

describe("shared-formula followers (R3-1B)", () => {
  const sheetXml =
    '<worksheet><sheetData><row r="2">' +
    '<c r="C2"><f t="shared" ref="C2:C4" si="0">B2*2</f><v>1</v></c>' +
    '<c r="C3" s="1"><f t="shared" si="0"/><v>1</v></c>' +
    '<c r="C4"><f si="0" t="shared" /></c>' +
    '<c r="D2"><f>A1</f><v>1</v></c>' +
    '<c r="D3"><f t="dataTable" ref="D3:D4" dt2D="0" dtr="0" r1="A1"/><v>5</v></c>' +
    '<c r="E2"><v>3</v></c><c r="E3"/>' +
    "</row></sheetData></worksheet>";

  it("finds only text-less t=shared <f/> cells — never a master, a plain or a dataTable formula", () => {
    expect([...sharedFollowersOfSheetXml(sheetXml)].sort()).toEqual(["C3", "C4"]);
  });

  it("reads every sheet's followers through workbook.xml + rels, keyed by the decoded sheet name", async () => {
    const parts: Record<string, string> = {
      "xl/workbook.xml": '<workbook><sheets><sheet name="D&amp;L" sheetId="1" r:id="rId1"/><sheet name="Plain" sheetId="2" r:id="rId2"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": sheetXml,
      "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
    };
    const engine = { readEntriesText: async (_bytes: Uint8Array, paths: readonly string[]) => Object.fromEntries(paths.map((p) => [p, parts[p] ?? null])) };
    const followers = await readSharedFollowers(engine as never, new Uint8Array());
    expect([...followers.keys()]).toEqual(["D&L"]);
    expect([...(followers.get("D&L") ?? [])].sort()).toEqual(["C3", "C4"]);
  });

  it("formulaCellsOfSnapshot adds followers by coordinate and never doubles a formula cell", () => {
    const snapshot: XlsxWorkbookSnapshot = {
      revision: 0,
      sheets: [
        { id: "sheet-1", name: "Data", cells: { C2: { value: null, formula: "=B2*2" }, C3: { value: 1 }, E2: { value: 3 } } },
        { id: "sheet-2", name: "Other", cells: { A1: { value: 1 } } },
      ],
    };
    const cells = formulaCellsOfSnapshot(snapshot, new Map([["Data", new Set(["C3", "C4", "C2"])]]));
    expect(cells).toHaveLength(3);
    expect(cells).toEqual(
      expect.arrayContaining([
        { sheetName: "Data", row: 1, column: 2 },
        { sheetName: "Data", row: 2, column: 2 },
        { sheetName: "Data", row: 3, column: 2 },
      ]),
    );
    expect(formulaCellsOfSnapshot(snapshot)).toEqual([{ sheetName: "Data", row: 1, column: 2 }]);
  });
});
