import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { XlsxGridEdit } from "./xlsx-edit-bridge";
import type { XlsxGridHostPort } from "./xlsx-grid-surface";
import { useXlsxEditorRibbonData } from "./use-xlsx-editor-ribbon-data";
import { foldTableEdits } from "./use-xlsx-editor-tables";

const fileHost = (tables: readonly { name: string; sheet: string }[]): XlsxGridHostPort =>
  ({
    file: {
      sheets: [
        {
          id: "s1",
          name: "Data",
          tabColor: null,
          tables: tables.filter((table) => table.sheet === "Data").map((table) => ({
            name: table.name,
            range: { startRow: 1, startColumn: 0, endRow: 4, endColumn: 2 },
          })),
        },
      ],
    },
  }) as unknown as XlsxGridHostPort;

const SHEETS = [{ id: "s1", name: "Data", hidden: false }] as const;

const tableEdit: XlsxGridEdit = {
  sheetId: "s1",
  name: "Sales",
  table: {
    area: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 },
    name: "Sales",
    columnNames: ["A", "B", "C"],
    bandedRows: true,
  },
};

describe("useXlsxEditorRibbonData", () => {
  it("seeds the live tables from the opened file and folds session edits on top", () => {
    const host = fileHost([{ name: "Budget", sheet: "Data" }]);
    const { result, rerender } = renderHook(
      ({ documentKey }) => useXlsxEditorRibbonData(SHEETS, host, null, documentKey),
      { initialProps: { documentKey: "doc-a" } },
    );
    expect(result.current.tables).toEqual([
      { sheet: "Data", name: "Budget", range: { startRow: 1, endRow: 4, startColumn: 0, endColumn: 2 } },
    ]);

    act(() => result.current.onTableEdits([tableEdit]));
    expect(result.current.tables.map((table) => table.name)).toEqual(["Budget", "Sales"]);

    rerender({ documentKey: "doc-b" });
    expect(result.current.tables.map((table) => table.name)).toEqual(["Budget"]);
  });

  it("drops the live tables folded for one document when another document opens", () => {
    const { result, rerender } = renderHook(
      ({ documentKey }) => useXlsxEditorRibbonData(SHEETS, undefined, null, documentKey),
      { initialProps: { documentKey: "doc-a" } },
    );

    act(() => result.current.onTableEdits([tableEdit]));
    expect(result.current.tables.map((table) => table.name)).toEqual(["Sales"]);

    rerender({ documentKey: "doc-a" });
    expect(result.current.tables).toHaveLength(1);

    rerender({ documentKey: "doc-b" });
    expect(result.current.tables).toEqual([]);
  });

  describe("sheet rename", () => {
    const renameEdit: XlsxGridEdit = { sheetId: "s1", sheetName: "Data", sheetOp: { kind: "rename-sheet", newName: "Budget" } };
    const RENAMED = [{ id: "s1", name: "Budget", hidden: false }] as const;

    it("moves a file-native table to the new sheet name so the Table tabs keep matching", () => {
      const host = fileHost([{ name: "Budget", sheet: "Data" }]);
      const { result } = renderHook(({ sheets }) => useXlsxEditorRibbonData(sheets, host, null, "doc-a"), { initialProps: { sheets: SHEETS as typeof SHEETS | typeof RENAMED } });
      act(() => result.current.onTableEdits([renameEdit]));
      expect(result.current.tables.map((table) => table.sheet)).toEqual(["Budget"]);
    });

    it("lets a delete-table emitted with the live name remove the file-native entry", () => {
      const host = fileHost([{ name: "Budget", sheet: "Data" }]);
      const { result, rerender } = renderHook(({ sheets }) => useXlsxEditorRibbonData(sheets, host, null, "doc-a"), { initialProps: { sheets: SHEETS as typeof SHEETS | typeof RENAMED } });
      act(() => result.current.onTableEdits([renameEdit]));
      rerender({ sheets: RENAMED });
      act(() => result.current.onTableEdits([{ sheetId: "s1", name: "Budget", table: null }]));
      expect(result.current.tables).toEqual([]);
    });

    it("moves a session-created table too", () => {
      const { result } = renderHook(() => useXlsxEditorRibbonData(SHEETS, undefined, null, "doc-a"));
      act(() => result.current.onTableEdits([tableEdit, renameEdit]));
      expect(result.current.tables.map((table) => [table.sheet, table.name])).toEqual([["Budget", "Sales"]]);
    });

    it("keeps the list referentially unchanged when the renamed sheet has no tables", () => {
      const tables = [{ sheet: "Other", name: "T", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }];
      expect(foldTableEdits(tables, [renameEdit], () => undefined)).toBe(tables);
    });
  });
});
