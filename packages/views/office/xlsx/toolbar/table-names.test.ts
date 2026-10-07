import { describe, expect, it } from "vitest";
import { nextTableName, tableNameTaken } from "./table-names";
import type { XlsxToolbarTable } from "./types";

const range = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 };
const table = (sheet: string, name: string): XlsxToolbarTable => ({ sheet, name, range });

describe("table names", () => {
  it("proposes Table1 for an empty workbook", () => {
    expect(nextTableName([])).toBe("Table1");
    expect(nextTableName(undefined)).toBe("Table1");
  });

  it("skips names taken on ANY sheet, case-insensitively", () => {
    expect(nextTableName([table("A", "Table1"), table("B", "table2")])).toBe("Table3");
  });

  it("fills a gap left by a removed table", () => {
    expect(nextTableName([table("A", "Table2")])).toBe("Table1");
  });

  it("does not count unrelated names towards the sequence", () => {
    expect(nextTableName([table("A", "Sales"), table("A", "Budget")])).toBe("Table1");
  });

  it("detects a taken name case-insensitively", () => {
    expect(tableNameTaken([table("A", "Sales")], "SALES")).toBe(true);
    expect(tableNameTaken([table("A", "Sales")], "Other")).toBe(false);
  });
});
