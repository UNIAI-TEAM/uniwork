import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { useXlsxPageSetup } from "./use-page-setup";

const mocks = vi.hoisted(() => ({
  downloadCsvFile: vi.fn(),
  installPrintStylesheet: vi.fn(),
  printDocument: vi.fn(),
}));

vi.mock("../export/download", () => ({
  downloadCsvFile: mocks.downloadCsvFile,
  csvFilename: (name: string | undefined) => `${name ?? "sheet"}.csv`,
  installPrintStylesheet: mocks.installPrintStylesheet,
  printDocument: mocks.printDocument,
}));

/** The open-time render model's host: the export must NOT read it. */
function renderHost(): XlsxGridHostPort {
  return {
    file: {
      sessionId: "s-1",
      name: "Book",
      sha256: "a".repeat(64),
      entryCount: 1,
      sheets: [{ id: "sheet-1", name: "Data", rowCount: 1, columnCount: 1, hidden: false, showGridLines: true, showFormulas: false, showRowColHeaders: true, rightToLeft: false, tabColor: null, defaultRowHeight: null, defaultRowHeightFixed: false, freeze: null, columnWidths: [], pivotTables: [], tables: [], comments: [], pivotRanges: [] }],
      styles: [],
      dxfStyles: [],
      visuals: [],
      definedNames: [],
      activeTab: 0,
      readOnly: false,
    },
    readRange: vi.fn(),
  } as unknown as XlsxGridHostPort;
}

function options(getSnapshot: () => XlsxWorkbookSnapshot | null) {
  return {
    host: renderHost(),
    selection: { sheet: "Data", address: "A1" },
    activeSheet: "Data",
    readOnly: false,
    canEdit: true,
    edit: vi.fn(),
    getSnapshot,
    onApplied: vi.fn(),
    onError: vi.fn(),
  };
}

describe("useXlsxPageSetup export/print", () => {
  beforeEach(() => {
    mocks.downloadCsvFile.mockReset();
    mocks.installPrintStylesheet.mockReset();
    mocks.printDocument.mockReset();
  });

  it("exports the LIVE session snapshot, not the open-time render model", () => {
    // The render model is built once at open; the snapshot is kept current by
    // edit(). The exported CSV must reflect the in-session edit.
    const live: XlsxWorkbookSnapshot = { revision: 3, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: "edited" }, B1: { value: 7 } } }] };
    const props = options(() => live);
    const hook = renderHook(() => useXlsxPageSetup(props));
    act(() => hook.result.current.exportCsv());
    expect(mocks.downloadCsvFile).toHaveBeenCalledWith("Data.csv", "\uFEFFedited,7");
    expect(props.host.readRange).not.toHaveBeenCalled();
  });

  it("does nothing without a live snapshot", () => {
    const props = options(() => null);
    const hook = renderHook(() => useXlsxPageSetup(props));
    act(() => hook.result.current.exportCsv());
    expect(mocks.downloadCsvFile).not.toHaveBeenCalled();
  });

  it("installs the print stylesheet and invokes the host print path", () => {
    const hook = renderHook(() => useXlsxPageSetup(options(() => null)));
    act(() => hook.result.current.print());
    expect(mocks.installPrintStylesheet).toHaveBeenCalledOnce();
    expect(mocks.printDocument).toHaveBeenCalledOnce();
  });
});