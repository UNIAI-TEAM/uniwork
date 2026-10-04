import { describe, expect, it } from "vitest";
import { csvCellText, csvSheetFromSnapshot, serializeSheetToCsv } from "./csv";

const sheet = (cells: Record<string, { v?: string | number | boolean | null; f?: string; c?: string | number | boolean | null }>, rowCount: number, columnCount: number) => ({ cells, rowCount, columnCount });

describe("csvCellText", () => {
  it("exports a formula's cached result and spells booleans the Excel way", () => {
    expect(csvCellText({ f: "=SUM(A1:A2)", c: 3 })).toBe("3");
    expect(csvCellText({ f: "=A1", c: null })).toBe("");
    expect(csvCellText({ v: true })).toBe("TRUE");
    expect(csvCellText({ v: false })).toBe("FALSE");
    expect(csvCellText(undefined)).toBe("");
  });
});

describe("serializeSheetToCsv", () => {
  it("writes the grid in order with CRLF rows and a UTF-8 BOM", () => {
    const csv = serializeSheetToCsv(sheet({ A1: { v: "Ten" }, B1: { v: "Tuoi" }, A2: { v: "An" }, B2: { v: 30 } }, 2, 2));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1)).toBe("Ten,Tuoi\r\nAn,30");
  });

  it("omits the BOM when asked", () => {
    const csv = serializeSheetToCsv(sheet({ A1: { v: 1 } }, 1, 1), { bom: false });
    expect(csv).toBe("1");
  });

  it("quotes delimiters, quotes and newlines per RFC4180", () => {
    const csv = serializeSheetToCsv(sheet({
      A1: { v: 'a,b' },
      B1: { v: 'say "hi"' },
      A2: { v: "line1\nline2" },
      B2: { v: "plain" },
    }, 2, 2), { bom: false });
    expect(csv).toBe('"a,b","say ""hi"""\r\n"line1\nline2",plain');
  });

  it("keeps Vietnamese text and fills empty cells", () => {
    const csv = serializeSheetToCsv(sheet({ A1: { v: "Doanh thu" }, C1: { v: "Quý III" } }, 1, 3), { bom: false });
    expect(csv).toBe("Doanh thu,,Quý III");
  });

  it("writes an empty sheet as an empty string", () => {
    expect(serializeSheetToCsv(sheet({}, 0, 0), { bom: false })).toBe("");
  });
});

describe("csvSheetFromSnapshot", () => {
  it("reads the live session snapshot's used range and in-session edits", () => {
    // The live snapshot is what a session edit updates; the open-time render
    // model would still hold the pre-edit value here.
    const sheet = csvSheetFromSnapshot({
      cells: {
        A1: { value: "Ten" },
        B1: { value: 2 },
        A2: { value: "An" },
        C3: { value: null },
      },
    });
    expect(sheet.rowCount).toBe(3);
    expect(sheet.columnCount).toBe(3);
    expect(serializeSheetToCsv(sheet, { bom: false })).toBe("Ten,2,\r\nAn,,\r\n,,");
  });

  it("exports a formula cell as its formula text with no cached result", () => {
    // The gateway snapshot stores formula cells as { value: null, formula }
    // with no cached <v>, so the CSV cell is empty until a recalc refreshes it.
    const sheet = csvSheetFromSnapshot({ cells: { A1: { value: null, formula: "=SUM(B1:B2)" }, B1: { value: 5 } } });
    expect(sheet.cells.A1).toEqual({ f: "=SUM(B1:B2)" });
    expect(serializeSheetToCsv(sheet, { bom: false })).toBe(",5");
  });

  it("carries a cached formula result when the snapshot has one", () => {
    const sheet = csvSheetFromSnapshot({ cells: { A1: { value: null, formula: "=1+1", rawValue: 2 } } });
    expect(sheet.cells.A1).toEqual({ f: "=1+1", c: 2 });
    expect(serializeSheetToCsv(sheet, { bom: false })).toBe("2");
  });
});
