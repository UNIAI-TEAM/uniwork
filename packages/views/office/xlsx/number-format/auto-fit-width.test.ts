import { describe, expect, it, vi } from "vitest";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { autoFitColumnsAfterFormat, fittedColumnPixels } from "./auto-fit-width";

const cells = [
  { row: 1, column: 1, value: 1250000 },
  { row: 2, column: 1, value: 12 },
  { row: 1, column: 2, value: "text" },
];

describe("fittedColumnPixels", () => {
  it("widens only columns whose formatted text exceeds the default width", () => {
    const fitted = fittedColumnPixels(cells, '"$"#,##0.00', 1, 2);
    expect(fitted.get(1)).toBeGreaterThan(59);
    expect(fitted.has(2)).toBe(false);
  });

  it("returns nothing when the text fits the default width", () => {
    expect(fittedColumnPixels([{ row: 0, column: 0, value: 12 }], "0", 0, 0).size).toBe(0);
  });
});

describe("autoFitColumnsAfterFormat", () => {
  const context = (readRange: ReturnType<typeof vi.fn>, execute: ReturnType<typeof vi.fn>) =>
    ({
      selection: { sheet: "S", address: "B2", endAddress: "B4" },
      commands: { execute },
      unitId: "file-x",
      sheetName: "S",
      host: { file: { sessionId: "s", sheets: [{ id: "sid", name: "S" }] }, readRange },
    }) as unknown as XlsxToolbarGroupProps;

  it("sets a wider width for the formatted column through the col-width command", async () => {
    const readRange = vi.fn(async () => ({ cells }));
    const execute = vi.fn(() => true);
    await autoFitColumnsAfterFormat(context(readRange, execute), '"$"#,##0.00');
    expect(execute).toHaveBeenCalledTimes(1);
    const [id, params] = execute.mock.calls[0] as unknown as [string, { value: number; ranges: unknown[] }];
    expect(id).toBe("sheet.command.set-worksheet-col-width");
    expect(params.value).toBeGreaterThan(59);
    expect(params.ranges).toEqual([{ startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 }]);
  });

  it("never narrows a column below the width it opened with (stored or seeded)", async () => {
    const readRange = vi.fn(async () => ({ cells }));
    const execute = vi.fn(() => true);
    const wide = context(readRange, execute);
    (wide.host as unknown as { file: { sheets: unknown[] } }).file.sheets = [
      { id: "sid", name: "S", columnWidths: [{ startColumn: 1, endColumn: 1, width: 40 }] },
    ];
    await autoFitColumnsAfterFormat(wide, '"$"#,##0.00');
    expect(execute).not.toHaveBeenCalled();
  });

  it("does nothing without a host or when nothing needs room", async () => {
    const execute = vi.fn(() => true);
    await autoFitColumnsAfterFormat({ ...context(vi.fn(), execute), host: undefined }, "0.00");
    await autoFitColumnsAfterFormat(context(vi.fn(async () => ({ cells: [{ row: 1, column: 1, value: 3 }] })), execute), "0");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("moreDecimals", () => {
  it("adds one decimal place", async () => {
    const { moreDecimals } = await import("./auto-fit-width");
    expect(moreDecimals("General")).toBe("0.0");
    expect(moreDecimals("#,##0")).toBe("#,##0.0");
    expect(moreDecimals("0.00")).toBe("0.000");
  });
});
