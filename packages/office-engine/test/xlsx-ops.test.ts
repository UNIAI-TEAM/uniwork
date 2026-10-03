// XLSX ops parser tests — the wire vocabulary is a closed set; malformed
// items are typed failures before any byte is touched.
import { describe, expect, it } from "vitest";
import { parseXlsxOps, XlsxOpError, XLSX_OP_KINDS, a1ToRowColumn, toA1, type XlsxSheetResolver } from "../src/xlsx/ops";

const sheets: XlsxSheetResolver = {
  sheetNames: () => ["Data", "Report"],
  nameForId: (id) => (id === "sheet-1" ? "Data" : id === "sheet-2" ? "Report" : undefined),
};

describe("a1/cell references", () => {
  it("toA1/a1ToRowColumn round-trip", () => {
    expect(toA1(0, 0)).toBe("A1");
    expect(toA1(0, 25)).toBe("Z1");
    expect(toA1(0, 26)).toBe("AA1");
    expect(toA1(1048575, 16383)).toBe("XFD1048576");
    expect(a1ToRowColumn("B7", "op", "f")).toEqual({ row: 6, column: 1 });
    expect(a1ToRowColumn("$AA$10", "op", "f")).toEqual({ row: 9, column: 26 });
  });
  it("rejects out-of-grid and malformed addresses", () => {
    expect(() => a1ToRowColumn("A0", "op", "f")).toThrow(XlsxOpError);
    expect(() => a1ToRowColumn("A1048577", "op", "f")).toThrow(XlsxOpError);
    expect(() => a1ToRowColumn("XFE1", "op", "f")).toThrow(XlsxOpError);
    expect(() => a1ToRowColumn("1A", "op", "f")).toThrow(XlsxOpError);
  });
});

describe("parseXlsxOps", () => {
  it("parses set_cell text / formula / scalar value", () => {
    const ops = parseXlsxOps(
      [
        { op: "set_cell", target: { sheet: "Data", cell: "A1" }, text: "42" },
        { op: "set_cell", target: { sheet: "Data", cell: "B1" }, attributes: { formula: "=SUM(A1:A3)" } },
        { op: "set_cell", target: { sheetId: "sheet-2", cell: "C2" }, attributes: { value: true } },
      ],
      sheets,
    );
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ kind: "set_cell", target: { sheetName: "Data", row: 0, column: 0 }, recalcInput: "42" });
    expect(ops[1]).toMatchObject({ cell: { formula: "=SUM(A1:A3)" }, recalcInput: "=SUM(A1:A3)" });
    expect(ops[2]).toMatchObject({ target: { sheetName: "Report" }, cell: { value: true } });
  });

  it("text starting with = is a formula; plain text stays literal", () => {
    const ops = parseXlsxOps(
      [
        { op: "set_cell", target: { sheet: "Data", cell: "A1" }, text: "=1+1" },
        { op: "set_cell", target: { sheet: "Data", cell: "A2" }, text: "hello" },
      ],
      sheets,
    );
    expect(ops[0]).toMatchObject({ cell: { formula: "=1+1" } });
    expect(ops[1]).toMatchObject({ cell: { value: "hello" } });
  });

  it("clear_cell produces a writeValue op and empty recalc input", () => {
    const ops = parseXlsxOps([{ op: "clear_cell", target: { sheet: "Data", cell: "B1" } }], sheets);
    expect(ops[0]).toMatchObject({ kind: "clear_cell", recalcInput: "" });
  });

  it("set_cells expands a range into per-cell ops", () => {
    const ops = parseXlsxOps(
      [{ op: "set_cells", target: { sheet: "Data" }, range: "A1:B2", attributes: { value: 0 } }],
      sheets,
    );
    expect(ops).toHaveLength(4);
    expect(ops.map((o) => o.target.address)).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("style-only set_cell carries no recalc input", () => {
    const ops = parseXlsxOps(
      [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, style: { bold: true } }],
      sheets,
    );
    expect(ops[0]).toMatchObject({ kind: "set_cell", writeValue: false, recalcInput: "" });
  });

  it("unknown op => unsupported XlsxOpError", () => {
    expect(() => parseXlsxOps([{ op: "drop_sheet", target: { sheet: "Data" } }], sheets)).toThrow(XlsxOpError);
    try {
      parseXlsxOps([{ op: "drop_sheet", target: { sheet: "Data" } }], sheets);
    } catch (e) {
      expect((e as XlsxOpError).unsupported).toBe(true);
    }
  });

  it("unknown sheet and malformed items => typed error", () => {
    expect(() =>
      parseXlsxOps([{ op: "set_cell", target: { sheet: "Ghost", cell: "A1" }, text: "x" }], sheets),
    ).toThrow(XlsxOpError);
    expect(() => parseXlsxOps(["nope"], sheets)).toThrow(XlsxOpError);
    expect(() => parseXlsxOps([{ op: "set_cell" }], sheets)).toThrow(XlsxOpError);
  });

  it("caps the op list at the envelope bound", () => {
    const many = Array.from({ length: 20001 }, () => ({ op: "clear_cell", target: { sheet: "Data", cell: "A1" } }));
    expect(() => parseXlsxOps(many, sheets)).toThrow(XlsxOpError);
  });
});

describe("op-kind registry", () => {
  it("binds the cell vocabulary in wire order on the cell-edit slot", () => {
    expect(XLSX_OP_KINDS.map((kind) => kind.wireName)).toEqual(["set_cell", "clear_cell", "set_cells"]);
    expect(XLSX_OP_KINDS.map((kind) => kind.slot)).toEqual(["cellEdits", "cellEdits", "cellEdits"]);
  });

  it("parses each bound kind through its own registry entry", () => {
    const items: Record<string, Record<string, unknown>> = {
      set_cell: { op: "set_cell", target: { sheet: "Data", cell: "A1" }, text: "x" },
      clear_cell: { op: "clear_cell", target: { sheet: "Data", cell: "A1" } },
      set_cells: { op: "set_cells", target: { sheet: "Data" }, range: "A1:B1", text: "x" },
    };
    for (const kind of XLSX_OP_KINDS) {
      const item = items[kind.wireName]!;
      const direct = kind.parse(item, kind.wireName, sheets);
      expect(direct.length).toBeGreaterThan(0);
      expect(parseXlsxOps([item], sheets)).toEqual(direct);
    }
  });

  it("keeps the unknown-op message listing the bound names from the registry", () => {
    let caught: XlsxOpError | undefined;
    try {
      parseXlsxOps([{ op: "drop_sheet", target: { sheet: "Data" } }], sheets);
    } catch (error) {
      caught = error as XlsxOpError;
    }
    expect(caught?.unsupported).toBe(true);
    expect(caught?.message).toBe("drop_sheet.: unknown op for xlsx (bound: set_cell, clear_cell, set_cells)");
  });
});
