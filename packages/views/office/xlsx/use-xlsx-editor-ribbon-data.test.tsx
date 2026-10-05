import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { XlsxGridEdit } from "./xlsx-edit-bridge";
import type { XlsxGridHostPort } from "./xlsx-grid-surface";
import { useXlsxEditorRibbonData } from "./use-xlsx-editor-ribbon-data";

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
});
