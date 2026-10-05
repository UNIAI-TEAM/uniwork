import { describe, expect, it } from "vitest";
import { gridlinesCommandParams, headerSizeCommands, XLSX_COLUMN_HEADER_HEIGHT, XLSX_COLUMN_HEADER_HEIGHT_COMMAND, XLSX_ROW_HEADER_WIDTH, XLSX_ROW_HEADER_WIDTH_COMMAND } from "./display";

describe("xlsx view display toggles", () => {
  it("asks for the wanted gridlines state and lets the renderer no-op a match", () => {
    expect(gridlinesCommandParams(true)).toEqual({ showGridlines: 1 });
    expect(gridlinesCommandParams(false)).toEqual({ showGridlines: 0 });
  });

  it("hides both header strips by sizing them to zero", () => {
    expect(headerSizeCommands(false)).toEqual([
      { id: XLSX_ROW_HEADER_WIDTH_COMMAND, params: { size: 0 } },
      { id: XLSX_COLUMN_HEADER_HEIGHT_COMMAND, params: { size: 0 } },
    ]);
  });

  it("restores the renderer's default header sizes", () => {
    expect(headerSizeCommands(true)).toEqual([
      { id: XLSX_ROW_HEADER_WIDTH_COMMAND, params: { size: XLSX_ROW_HEADER_WIDTH } },
      { id: XLSX_COLUMN_HEADER_HEIGHT_COMMAND, params: { size: XLSX_COLUMN_HEADER_HEIGHT } },
    ]);
  });
});
