import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { OfficePrintPort } from "../../print";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { useXlsxPageSetup } from "./use-page-setup";

const mocks = vi.hoisted(() => ({
  downloadCsvFile: vi.fn(),
}));

vi.mock("../export/download", () => ({
  downloadCsvFile: mocks.downloadCsvFile,
  csvFilename: (name: string | undefined) => `${name ?? "sheet"}.csv`,
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
    readRange: vi.fn(async () => ({ cells: [{ row: 0, column: 0, value: "model" }], rows: [], merges: [] })),
  } as unknown as XlsxGridHostPort;
}

function options(getSnapshot: () => XlsxWorkbookSnapshot | null, printPort?: OfficePrintPort | null) {
  return {
    printPort,
    title: "Book",
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

  it("prints a copy of the active sheet through the injected port, honouring this session's dialog edits", async () => {
    const live: XlsxWorkbookSnapshot = { revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: "<b>live</b>" } } }] };
    const port: OfficePrintPort = { print: vi.fn(() => ({ outcome: "printed" as const })) };
    const props = options(() => live, port);
    const hook = renderHook(() => useXlsxPageSetup(props));
    act(() => hook.result.current.applyPageSetup({ orientation: "landscape" }));
    await waitFor(() => expect(props.onApplied).toHaveBeenCalledOnce());
    expect(hook.result.current.printMenuItem).not.toBeNull();
    act(() => hook.result.current.print?.());
    await waitFor(() => expect(port.print).toHaveBeenCalledOnce());
    const request = vi.mocked(port.print).mock.calls[0]![0];
    expect(request.title).toBe("Book");
    expect(request.html).toContain("&lt;b&gt;live&lt;/b&gt;");
    expect(request.html).not.toContain("model");
    expect(request.html).toContain("@page{size:11.69in 8.27in;");
  });

  it("offers no print without a port (null) and never touches window.print", () => {
    const windowPrint = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const hook = renderHook(() => useXlsxPageSetup(options(() => null, null)));
    expect(hook.result.current.print).toBeUndefined();
    expect(hook.result.current.printMenuItem).toBeNull();
    expect(windowPrint).not.toHaveBeenCalled();
    windowPrint.mockRestore();
  });
});
