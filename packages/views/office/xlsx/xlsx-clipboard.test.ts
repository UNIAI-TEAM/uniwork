import { describe, expect, it } from "vitest";
import { clipboardCells, XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";

describe("xlsx clipboard edit bound", () => {
  it("matches the server's 10k edit-op limit", () => {
    expect(XLSX_CLIENT_MAX_EDIT_OPS).toBe(10_000);
    const text = Array.from({ length: XLSX_CLIENT_MAX_EDIT_OPS + 1 }, () => "x").join("\n");
    expect(() => clipboardCells({ sheet: "Sheet1", address: "A1" }, text)).toThrow("xlsx_clipboard_outside_bounds");
  });
});
