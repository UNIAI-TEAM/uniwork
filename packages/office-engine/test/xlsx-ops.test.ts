// XLSX ops parser tests — the wire vocabulary is a closed set; malformed
// items are typed failures before any byte is touched.
import { describe, expect, it } from "vitest";
import { parseXlsxOps, XlsxOpError, XLSX_OP_KINDS, a1ToRowColumn, toA1, groupXlsxStructuralOps, type XlsxSheetResolver } from "../src/xlsx/ops";

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
    expect(ops.flatMap((op) => (op.kind === "set_cell" ? [op.target.address] : []))).toEqual(["A1", "B1", "A2", "B2"]);
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
  it("binds the vocabulary in wire order with each kind's gateway slot", () => {
    expect(XLSX_OP_KINDS.map((kind) => kind.wireName)).toEqual([
      "set_cell", "clear_cell", "set_cells",
      "insert_rows", "remove_rows", "insert_cols", "remove_cols",
      "set_row_size", "set_col_size", "set_rows_hidden", "set_cols_hidden", "set_rows_outline", "set_cols_outline",
    ]);
    expect(XLSX_OP_KINDS.map((kind) => kind.slot)).toEqual([
      "cellEdits", "cellEdits", "cellEdits",
      "structuralOps", "structuralOps", "structuralOps", "structuralOps",
      "structuralOps", "structuralOps", "structuralOps", "structuralOps", "structuralOps", "structuralOps",
    ]);
  });

  it("parses each bound kind through its own registry entry", () => {
    const items: Record<string, Record<string, unknown>> = {
      set_cell: { op: "set_cell", target: { sheet: "Data", cell: "A1" }, text: "x" },
      clear_cell: { op: "clear_cell", target: { sheet: "Data", cell: "A1" } },
      set_cells: { op: "set_cells", target: { sheet: "Data" }, range: "A1:B1", text: "x" },
      insert_rows: { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
      remove_rows: { op: "remove_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
      insert_cols: { op: "insert_cols", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
      remove_cols: { op: "remove_cols", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
      set_row_size: { op: "set_row_size", target: { sheet: "Data" }, attributes: { start: 0, end: 0, size: 20 } },
      set_col_size: { op: "set_col_size", target: { sheet: "Data" }, attributes: { start: 0, end: 0, size: null } },
      set_rows_hidden: { op: "set_rows_hidden", target: { sheet: "Data" }, attributes: { start: 0, end: 0, hidden: true } },
      set_cols_hidden: { op: "set_cols_hidden", target: { sheet: "Data" }, attributes: { start: 0, end: 0, hidden: false } },
      set_rows_outline: { op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 0, end: 0, level: 2 } },
      set_cols_outline: { op: "set_cols_outline", target: { sheet: "Data" }, attributes: { start: 0, end: 0, level: 0 } },
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
    const bound = XLSX_OP_KINDS.map((kind) => kind.wireName).join(", ");
    expect(caught?.unsupported).toBe(true);
    expect(caught?.message).toBe(`drop_sheet.: unknown op for xlsx (bound: ${bound})`);
  });
});

describe("structural ops", () => {
  const parse = (item: Record<string, unknown>) => parseXlsxOps([item], sheets);

  it("parses the four shift kinds with 0-based index and count", () => {
    expect(parse({ op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 5, count: 3 } })).toEqual([
      { kind: "insert_rows", sheetName: "Data", index: 5, count: 3 },
    ]);
    expect(parse({ op: "remove_rows", target: { sheetId: "sheet-2" }, attributes: { index: 0, count: 1 } })).toEqual([
      { kind: "remove_rows", sheetName: "Report", index: 0, count: 1 },
    ]);
    expect(parse({ op: "insert_cols", target: { sheet: "Data" }, attributes: { index: 16383, count: 1 } })).toEqual([
      { kind: "insert_cols", sheetName: "Data", index: 16383, count: 1 },
    ]);
    expect(parse({ op: "remove_cols", target: { sheet: "Data" }, attributes: { index: 26, count: 2 } })).toEqual([
      { kind: "remove_cols", sheetName: "Data", index: 26, count: 2 },
    ]);
  });

  it("parses sizes (null = sheet default), hidden flags and outline levels", () => {
    expect(parse({ op: "set_row_size", target: { sheet: "Data" }, attributes: { start: 1, end: 4, size: 22.5 } })).toEqual([
      { kind: "set_row_size", sheetName: "Data", start: 1, end: 4, size: 22.5 },
    ]);
    expect(parse({ op: "set_col_size", target: { sheet: "Data" }, attributes: { start: 0, end: 0, size: null } })).toEqual([
      { kind: "set_col_size", sheetName: "Data", start: 0, end: 0, size: null },
    ]);
    expect(parse({ op: "set_rows_hidden", target: { sheet: "Data" }, attributes: { start: 2, end: 2, hidden: true } })).toEqual([
      { kind: "set_rows_hidden", sheetName: "Data", start: 2, end: 2, hidden: true },
    ]);
    expect(parse({ op: "set_cols_hidden", target: { sheet: "Data" }, attributes: { start: 2, end: 5, hidden: false } })).toEqual([
      { kind: "set_cols_hidden", sheetName: "Data", start: 2, end: 5, hidden: false },
    ]);
    expect(parse({ op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 3, end: 6, level: 7, collapsed: true } })).toEqual([
      { kind: "set_rows_outline", sheetName: "Data", start: 3, end: 6, level: 7, collapsed: true },
    ]);
    // An omitted collapsed leaves the file's flag untouched: the parsed op
    // must not carry the key at all.
    const [op] = parse({ op: "set_cols_outline", target: { sheet: "Data" }, attributes: { start: 0, end: 1, level: 0 } });
    expect(op).toEqual({ kind: "set_cols_outline", sheetName: "Data", start: 0, end: 1, level: 0 });
    expect(Object.keys(op!)).toEqual(["kind", "sheetName", "start", "end", "level"]);
  });

  it("refuses malformed shapes, out-of-grid spans and reversed ranges", () => {
    const invalid: Record<string, unknown>[] = [
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: -1, count: 1 } },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 0 } },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 1_048_575, count: 2 } },
      { op: "insert_cols", target: { sheet: "Data" }, attributes: { index: 16_383, count: 2 } },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0.5, count: 1 } },
      { op: "insert_rows", target: { sheet: "Data" } },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: "nope" },
      { op: "set_row_size", target: { sheet: "Data" }, attributes: { start: 5, end: 2, size: 10 } },
      { op: "set_row_size", target: { sheet: "Data" }, attributes: { start: 0, end: 1_048_576, size: 10 } },
      { op: "set_col_size", target: { sheet: "Data" }, attributes: { start: 0, end: 0, size: 0 } },
      { op: "set_col_size", target: { sheet: "Data" }, attributes: { start: 0, end: 0, size: 501 } },
      { op: "set_col_size", target: { sheet: "Data" }, attributes: { start: 0, end: 0, size: "10" } },
      { op: "set_rows_hidden", target: { sheet: "Data" }, attributes: { start: 0, end: 0, hidden: 1 } },
      { op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 0, end: 0, level: 8 } },
      { op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 0, end: 0, level: -1 } },
      { op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 0, end: 0, level: 1, collapsed: "yes" } },
      { op: "set_rows_hidden", target: { sheet: "Ghost" }, attributes: { start: 0, end: 0, hidden: true } },
    ];
    for (const item of invalid) {
      expect(() => parse(item), JSON.stringify(item)).toThrow(XlsxOpError);
    }
  });

  it("groups per sheet in journal order for the gateway's structuralOps slot", () => {
    const groups = groupXlsxStructuralOps(parseXlsxOps([
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 1, count: 2 } },
      { op: "set_cell", target: { sheet: "Data", cell: "A1" }, text: "x" },
      { op: "set_rows_hidden", target: { sheet: "Data" }, attributes: { start: 4, end: 4, hidden: true } },
      { op: "set_cols_outline", target: { sheet: "Report" }, attributes: { start: 0, end: 2, level: 3, collapsed: false } },
      { op: "remove_rows", target: { sheet: "Data" }, attributes: { index: 9, count: 1 } },
    ], sheets));
    expect(groups).toEqual([
      {
        sheetName: "Data",
        ops: [
          { kind: "insert-rows", index: 1, count: 2 },
          { kind: "set-rows-hidden", start: 4, end: 4, hidden: true },
          { kind: "remove-rows", index: 9, count: 1 },
        ],
      },
      { sheetName: "Report", ops: [{ kind: "set-cols-outline", start: 0, end: 2, level: 3, collapsed: false }] },
    ]);
  });
});
