import { describe, expect, it } from "vitest";
import { clipboardCells, selectionClipboardText, XLSX_CLIENT_MAX_COPY_CELLS, XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";

describe("xlsx clipboard edit bound", () => {
  it("matches the server's 10k edit-op limit", () => {
    expect(XLSX_CLIENT_MAX_EDIT_OPS).toBe(10_000);
    const text = Array.from({ length: XLSX_CLIENT_MAX_EDIT_OPS + 1 }, () => "x").join("\n");
    expect(() => clipboardCells({ sheet: "Sheet1", address: "A1" }, text)).toThrow("xlsx_clipboard_outside_bounds");
  });

  it("allows the larger local-only copy range while keeping the edit limit at 10k", () => {
    expect(XLSX_CLIENT_MAX_COPY_CELLS).toBe(20_000);
    const snapshot = { revision: 1, sheets: [{ id: "sheet-1", name: "Sheet1", cells: {} }] };
    expect(selectionClipboardText(snapshot, { sheet: "Sheet1", address: "A1", endAddress: "GR100" }).split("\n")).toHaveLength(100);
    expect(() => selectionClipboardText(snapshot, { sheet: "Sheet1", address: "A1", endAddress: "GS100" })).toThrow("xlsx_clipboard_outside_bounds");
  });
});
