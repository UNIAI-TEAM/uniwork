import { act, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { XlsxGridSurface, type XlsxGridHandle, type XlsxRendererModule } from "./xlsx-grid-surface";
import type { XlsxGridHostPort } from "./xlsx-grid-surface";

const file = {
  sessionId: "s-1",
  name: "book.xlsx",
  sha256: "c".repeat(64),
  entryCount: 3,
  sheets: [{ id: "sheet-1", name: "Data", rowCount: 10, columnCount: 5, hidden: false, showGridLines: true, showFormulas: false, showRowColHeaders: true, rightToLeft: false, tabColor: null, defaultRowHeight: null, defaultRowHeightFixed: false, freeze: null, columnWidths: [], pivotTables: [] }],
  styles: [],
  dxfStyles: [],
  visuals: [],
  definedNames: [],
  activeTab: 0,
  readOnly: false,
} as never;

const host: XlsxGridHostPort = {
  file,
  async readRange() {
    return { cells: [], rows: [], merges: [], hyperlinks: [], conditionalRules: [], autoFilter: null, autoFilterColumns: [], dataValidations: [], sheetProtection: null, protectedRanges: [], pageSetup: null, rowBreaks: [], colBreaks: [], indexedThroughRow: 9 } as never;
  },
};

function fakeModule() {
  const handle: XlsxGridHandle = {
    loadWorkbook: vi.fn().mockResolvedValue(undefined),
    refreshViewport: vi.fn(),
    revealCell: vi.fn().mockResolvedValue(undefined),
    setCellText: vi.fn(),
    commitEdit: vi.fn(async () => undefined),
    selectSheet: vi.fn(),
    setNumberFormat: vi.fn(),
    executeCommand: vi.fn(() => true),
    getActiveFormatState: vi.fn(() => null),
    setDarkMode: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getDirtyGeneration: vi.fn(() => 0),
    dispose: vi.fn(),
  };
  const options: { current: Parameters<XlsxRendererModule["createXlsxRenderer"]>[0] | null } = { current: null };
  const module: XlsxRendererModule = {
    installXlsxRendererStyles: vi.fn(),
    createXlsxRenderer: vi.fn((opts) => {
      options.current = opts;
      return handle;
    }),
  };
  return { module, handle, options };
}

describe("XlsxGridSurface", () => {
  it("mounts the vendored renderer, loads the workbook and reports ready", async () => {
    const { module, handle, options } = fakeModule();
    const onReady = vi.fn();
    const ref = createRef<XlsxGridHandle>();
    render(<XlsxGridSurface ref={ref} documentKey="doc-1" host={host} loadModule={async () => module} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(module.installXlsxRendererStyles).toHaveBeenCalled();
    expect(module.createXlsxRenderer).toHaveBeenCalled();
    expect(options.current?.container).toBeInstanceOf(HTMLElement);
    expect(handle.loadWorkbook).toHaveBeenCalledWith(file);
    expect(ref.current?.getDirtyGeneration()).toBe(0);
  });

  it("routes the renderer callbacks back to the host", async () => {
    const { module, options } = fakeModule();
    const onDirty = vi.fn();
    const onSelectionChange = vi.fn();
    render(<XlsxGridSurface documentKey="doc-2" host={host} loadModule={async () => module} onDirty={onDirty} onSelectionChange={onSelectionChange} />);
    await waitFor(() => expect(options.current).not.toBeNull());
    act(() => {
      options.current?.onDirty?.();
      options.current?.onSelectionChange?.({ sheetId: "sheet-1", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 } });
    });
    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({ sheetId: "sheet-1", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 } });
  });

  it("disposes the renderer when the document changes", async () => {
    const { module, handle } = fakeModule();
    const { rerender } = render(<XlsxGridSurface documentKey="doc-a" host={host} loadModule={async () => module} />);
    await waitFor(() => expect(handle.loadWorkbook).toHaveBeenCalled());
    rerender(<XlsxGridSurface documentKey="doc-b" host={host} loadModule={async () => module} />);
    await waitFor(() => expect(handle.dispose).toHaveBeenCalled());
  });

  it("updates theme without discarding the live workbook or undo journal", async () => {
    const { module, handle } = fakeModule();
    const { rerender } = render(<XlsxGridSurface documentKey="theme-doc" host={host} loadModule={async () => module} />);
    await waitFor(() => expect(handle.loadWorkbook).toHaveBeenCalledOnce());
    rerender(<XlsxGridSurface documentKey="theme-doc" host={host} dark loadModule={async () => module} />);
    expect(handle.setDarkMode).toHaveBeenLastCalledWith(true);
    expect(handle.dispose).not.toHaveBeenCalled();
    expect(handle.loadWorkbook).toHaveBeenCalledOnce();
  });

  it("forwards commands to the artifact handle and reports its boolean result", async () => {
    const { module, handle } = fakeModule();
    const ref = createRef<XlsxGridHandle>();
    render(<XlsxGridSurface ref={ref} documentKey="cmd-doc" host={host} loadModule={async () => module} />);
    await waitFor(() => expect(handle.loadWorkbook).toHaveBeenCalled());
    expect(ref.current?.executeCommand("sheet.command.set-bold")).toBe(true);
    expect(handle.executeCommand).toHaveBeenCalledWith("sheet.command.set-bold", undefined);
    vi.mocked(handle.executeCommand).mockReturnValue(false);
    expect(ref.current?.executeCommand("sheet.command.set-font-size", { value: 14 })).toBe(false);
    expect(handle.executeCommand).toHaveBeenLastCalledWith("sheet.command.set-font-size", { value: 14 });
  });

  it("forwards the active format state read to the artifact handle", async () => {
    const { module, handle } = fakeModule();
    const state = {
      fontFamily: "Calibri", fontSize: 14, bold: true, italic: false, underline: false, strike: false,
      textColor: null, fillColor: null, horizontalAlign: 2, verticalAlign: 1, wrap: true, textRotation: 45,
    };
    vi.mocked(handle.getActiveFormatState).mockReturnValue(state);
    const ref = createRef<XlsxGridHandle>();
    render(<XlsxGridSurface ref={ref} documentKey="state-doc" host={host} loadModule={async () => module} />);
    await waitFor(() => expect(handle.loadWorkbook).toHaveBeenCalled());
    expect(ref.current?.getActiveFormatState()).toBe(state);
  });

  it("shows a typed failure when the artifact cannot load", async () => {
    const onFailure = vi.fn();
    render(<XlsxGridSurface documentKey="doc-3" host={host} loadModule={async () => { throw new Error("chunk_unavailable"); }} onFailure={onFailure} />);
    await waitFor(() => expect(onFailure).toHaveBeenCalledWith("chunk_unavailable"));
    expect(screen.getByTestId("xlsx-grid-failure")).toBeDefined();
  });
});
